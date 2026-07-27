'use client'

import { CheckCircle2, LoaderCircle, SlidersHorizontal } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  type TuningAdvisory,
  type TuningConfigSnapshot,
  useTuningRecommendation,
} from '@/app/hooks/useTuningRecommendation'
import { useTuningStatus } from '@/app/hooks/useTuningStatus'
import {
  type PendingCommand,
  usePendingTuningCommand,
} from '@/app/hooks/usePendingTuningCommand'
import { TuningStatusBadge } from '@/app/components/tuning/TuningStatusBadge'
import { TuningDiffView } from '@/app/components/tuning/TuningDiffView'
import {
  CoverageWarning,
  isTuningRecommendationBlocked,
} from '@/app/components/tuning/CoverageWarning'

interface TuningAdvisoryPanelProps {
  deviceId: string | null | undefined
}

export function TuningPanelHeader({ pendingCommand }: { pendingCommand: PendingCommand | null }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="flex gap-3">
        <div className="rounded-lg bg-cyan-500/10 p-2 text-cyan-300">
          <SlidersHorizontal className="size-5" aria-hidden="true" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">Khuyến nghị tinh chỉnh</h3>
          <p className="mt-1 text-xs text-muted-foreground">Đề xuất tinh chỉnh cho thiết bị</p>
          <p className="text-xs text-muted-foreground">Chỉ áp dụng khi bạn xác nhận và thiết bị chạy ổn định.</p>
        </div>
      </div>
      {pendingCommand && (
        <TuningStatusBadge
          state={pendingCommand.state}
          rejectionReason={pendingCommand.rejectionReason}
        />
      )}
    </div>
  )
}

export function TuningPanelActions({
  confirmDisabled,
  isSubmitting,
  isCommandPending,
  isBlocked,
  deviceId,
  onRequestConfirmation,
  onManualRefresh,
}: {
  confirmDisabled: boolean
  isSubmitting: boolean
  isCommandPending: boolean
  isBlocked: boolean
  deviceId: string | null | undefined
  onRequestConfirmation: () => void
  onManualRefresh: () => void
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <Button onClick={onRequestConfirmation} disabled={confirmDisabled}>
        {isSubmitting || isCommandPending ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <CheckCircle2 aria-hidden="true" />
        )}
        Áp dụng đề xuất
      </Button>
      <Button variant="outline" onClick={onManualRefresh} disabled={!deviceId || isSubmitting}>
        Tải lại đề xuất
      </Button>
      {(isBlocked || isCommandPending) && (
        <span className="text-xs text-muted-foreground">
          {isCommandPending ? 'Đang chờ thiết bị phản hồi.' : 'Chưa đủ dữ liệu tin cậy để đề xuất. Hãy để hệ thống chạy thêm rồi thử lại.'}
        </span>
      )}
    </div>
  )
}

function useTuningPanelHandlers(
  deviceId: string | null | undefined,
  advisory: TuningAdvisory | null,
  dataDeviceId: string | undefined,
  confirmDisabled: boolean,
  refetch: () => Promise<unknown>,
  resyncDurableState: () => Promise<void>,
  submitRecommendation: (config: TuningConfigSnapshot) => Promise<boolean>,
  setSubmissionError: (error: string | null) => void,
  setConfirmOpen: React.Dispatch<React.SetStateAction<boolean>>,
) {
  const requestConfirmation = useCallback(() => {
    if (confirmDisabled) return
    setSubmissionError(null)
    setConfirmOpen(true)
  }, [confirmDisabled, setSubmissionError, setConfirmOpen])

  const handleConfirmSubmit = useCallback(async () => {
    if (!advisory || !deviceId || dataDeviceId !== deviceId) return
    const success = await submitRecommendation(advisory.suggestedConfig)
    if (success) setConfirmOpen(false)
  }, [advisory, deviceId, dataDeviceId, submitRecommendation, setConfirmOpen])

  const handleManualRefresh = useCallback(async () => {
    await refetch()
    await resyncDurableState()
  }, [refetch, resyncDurableState])

  return { requestConfirmation, handleConfirmSubmit, handleManualRefresh }
}

function usePanelStateSetup(deviceId: string | null | undefined) {
  const { data, isLoading, error, refetch } = useTuningRecommendation(deviceId)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const prevDeviceIdRef = useRef(deviceId)
  if (prevDeviceIdRef.current !== deviceId) {
    prevDeviceIdRef.current = deviceId
    if (confirmOpen) setConfirmOpen(false)
  }

  const resyncRef = useRef<() => Promise<void>>(async () => {})
  const handleReconnect = useCallback(async () => {
    await refetch()
    await resyncRef.current()
  }, [refetch])

  const { event: tuningEvent } = useTuningStatus(deviceId, handleReconnect)
  const cmd = usePendingTuningCommand(deviceId, tuningEvent)

  useEffect(() => {
    resyncRef.current = cmd.resyncDurableState
  }, [cmd.resyncDurableState])

  return { data, isLoading, error, refetch, confirmOpen, setConfirmOpen, cmd }
}

export function useTuningAdvisoryPanelState(deviceId: string | null | undefined) {
  const setup = usePanelStateSetup(deviceId)

  const safeData = setup.data && deviceId && setup.data.deviceId === deviceId ? setup.data : null
  const advisory = safeData?.advisory ?? null
  const currentConfig = safeData?.currentConfig ?? null
  const isBlocked =
    !deviceId || !safeData || isTuningRecommendationBlocked(safeData.blockReason) || advisory === null

  const isCommandPending =
    setup.cmd.pendingCommand?.state === 'PENDING' || setup.cmd.pendingCommand?.state === 'TIMEOUT'
  const confirmDisabled = isBlocked || setup.cmd.isSubmitting || isCommandPending

  const handlers = useTuningPanelHandlers(
    deviceId,
    advisory,
    safeData?.deviceId,
    confirmDisabled,
    setup.refetch,
    setup.cmd.resyncDurableState,
    setup.cmd.submitRecommendation,
    setup.cmd.setSubmissionError,
    setup.setConfirmOpen,
  )

  return {
    data: safeData,
    isLoading: setup.isLoading,
    error: setup.error,
    confirmOpen: setup.confirmOpen,
    setConfirmOpen: setup.setConfirmOpen,
    advisory,
    currentConfig,
    isBlocked,
    pendingCommand: setup.cmd.pendingCommand,
    isSubmitting: setup.cmd.isSubmitting,
    submissionError: setup.cmd.submissionError,
    isCommandPending,
    confirmDisabled,
    ...handlers,
  }
}

export function TuningPanelBody({
  panel,
}: {
  panel: ReturnType<typeof useTuningAdvisoryPanelState>
}) {
  return (
    <>
      {panel.isLoading && !panel.data && (
        <p className="text-sm text-muted-foreground">Đang phân tích dữ liệu vận hành…</p>
      )}
      {panel.error && (
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">
          {panel.error.message}
        </p>
      )}
      {panel.data && (
        <CoverageWarning
          blockReason={panel.data.blockReason}
          detail={panel.data.blockReasonDetail}
        />
      )}
      {panel.advisory && (
        <div className="space-y-4">
          <AdvisorySummary advisory={panel.advisory} />
          {panel.currentConfig && (
            <TuningDiffView
              currentConfig={panel.currentConfig}
              suggestedConfig={panel.advisory.suggestedConfig}
              delta={panel.advisory.delta}
            />
          )}
        </div>
      )}
      {panel.submissionError && (
        <p role="alert" className="mt-4 rounded-md border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">
          {panel.submissionError}
        </p>
      )}
    </>
  )
}

export function TuningAdvisoryPanel({ deviceId }: TuningAdvisoryPanelProps) {
  const panel = useTuningAdvisoryPanelState(deviceId)

  return (
    <Card className="border border-slate-700/50 bg-slate-950/40 p-6">
      <TuningPanelHeader pendingCommand={panel.pendingCommand} />
      <TuningPanelBody panel={panel} />
      <TuningPanelActions
        confirmDisabled={panel.confirmDisabled}
        isSubmitting={panel.isSubmitting}
        isCommandPending={panel.isCommandPending}
        isBlocked={panel.isBlocked}
        deviceId={deviceId}
        onRequestConfirmation={panel.requestConfirmation}
        onManualRefresh={() => void panel.handleManualRefresh()}
      />
      {panel.confirmOpen && panel.advisory && (
        <ConfirmationDialog
          onCancel={() => panel.setConfirmOpen(false)}
          onConfirm={() => void panel.handleConfirmSubmit()}
          isSubmitting={panel.isSubmitting}
          config={panel.advisory.suggestedConfig}
        />
      )}
    </Card>
  )
}

export function AdvisorySummary({ advisory }: { advisory: TuningAdvisory }) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-700/50 bg-slate-900/30 p-4">
      <p className="text-sm text-slate-100">{advisory.expectedBenefit}</p>
      <div className="flex flex-wrap gap-2">
        {advisory.triggeredRules.map((rule) => (
          <span key={rule} className="rounded border border-cyan-500/25 bg-cyan-950/30 px-2 py-1 text-xs text-cyan-100">
            {rule}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Độ tin cậy: <strong className="text-slate-200">{advisory.confidence}</strong> · Quy tắc {advisory.rulesetVersion}
      </p>
    </div>
  )
}

export function ConfirmationDialog({
  config,
  isSubmitting,
  onCancel,
  onConfirm,
}: {
  config: TuningConfigSnapshot
  isSubmitting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="tuning-confirmation-title">
      <button aria-label="Đóng xác nhận" className="absolute inset-0 cursor-default bg-slate-950/70" onClick={onCancel} disabled={isSubmitting} />
      <div className="relative w-full max-w-md rounded-lg border border-slate-700 bg-slate-950 p-5 shadow-2xl">
        <h4 id="tuning-confirmation-title" className="text-base font-semibold text-foreground">Xác nhận gửi cấu hình</h4>
        <p className="mt-2 text-sm text-muted-foreground">Lệnh sẽ được lưu ở trạng thái chờ; chỉ hoàn tất khi thiết bị xác nhận qua luồng đồng bộ.</p>
        <ConfigPreview config={config} />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>Hủy</Button>
          <Button onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            Gửi lệnh tinh chỉnh
          </Button>
        </div>
      </div>
    </div>
  )
}

export function ConfigPreview({ config }: { config: TuningConfigSnapshot }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 rounded-md bg-slate-900/60 p-3 text-xs">
      <dt className="text-muted-foreground">Lamp gain</dt><dd className="text-right font-mono text-slate-100">{config.lamp_gain_scale.toFixed(2)}</dd>
      <dt className="text-muted-foreground">Mist gain</dt><dd className="text-right font-mono text-slate-100">{config.mist_gain_scale.toFixed(2)}</dd>
      <dt className="text-muted-foreground">Mist ON</dt><dd className="text-right font-mono text-slate-100">{config.mist_on_threshold.toFixed(2)}</dd>
      <dt className="text-muted-foreground">Mist OFF</dt><dd className="text-right font-mono text-slate-100">{config.mist_off_threshold.toFixed(2)}</dd>
    </dl>
  )
}
