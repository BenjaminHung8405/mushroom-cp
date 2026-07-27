'use client'

import { CheckCircle2, LoaderCircle, SlidersHorizontal } from 'lucide-react'
import { useCallback, useState } from 'react'

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
          <p className="mt-1 text-xs text-muted-foreground">
            Chỉ áp dụng sau khi người vận hành xác nhận và thiết bị ghi nhận bền vững.
          </p>
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
        Xác nhận áp dụng
      </Button>
      <Button variant="outline" onClick={onManualRefresh} disabled={!deviceId || isSubmitting}>
        Làm mới đề xuất
      </Button>
      {(isBlocked || isCommandPending) && (
        <span className="text-xs text-muted-foreground">
          {isCommandPending ? 'Đang chờ thiết bị phản hồi.' : 'Xác nhận bị khóa cho đến khi đủ điều kiện.'}
        </span>
      )}
    </div>
  )
}

/**
 * Presents a server-generated tuning recommendation and submits it only after
 * the operator explicitly confirms it. A 202 merely establishes a pending
 * command; terminal UI state is driven solely by a matching durable state event.
 */
export function TuningAdvisoryPanel({ deviceId }: TuningAdvisoryPanelProps) {
  const { data, isLoading, error, refetch } = useTuningRecommendation(deviceId)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleReconnect = useCallback(async () => {
    await refetch()
  }, [refetch])

  const { event: tuningEvent } = useTuningStatus(deviceId, handleReconnect)
  const {
    pendingCommand,
    isSubmitting,
    submissionError,
    setSubmissionError,
    submitRecommendation,
    resyncDurableState,
  } = usePendingTuningCommand(deviceId, tuningEvent)

  const advisory = data?.advisory ?? null
  const currentConfig = data?.currentConfig ?? null
  const isBlocked =
    !deviceId ||
    !data ||
    isTuningRecommendationBlocked(data.blockReason) ||
    advisory === null

  const isCommandPending = pendingCommand?.state === 'PENDING'
  const confirmDisabled = isBlocked || isSubmitting || isCommandPending

  const requestConfirmation = () => {
    if (confirmDisabled) return
    setSubmissionError(null)
    setConfirmOpen(true)
  }

  const handleConfirmSubmit = async () => {
    if (!advisory) return
    const success = await submitRecommendation(advisory.suggestedConfig)
    if (success) {
      setConfirmOpen(false)
    }
  }

  const handleManualRefresh = async () => {
    await refetch()
    await resyncDurableState()
  }

  return (
    <Card className="border border-slate-700/50 bg-slate-950/40 p-6">
      <TuningPanelHeader pendingCommand={pendingCommand} />

      {isLoading && !data && (
        <p className="text-sm text-muted-foreground">Đang phân tích dữ liệu vận hành…</p>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">
          {error.message}
        </p>
      )}

      {data && (
        <CoverageWarning
          blockReason={data.blockReason}
          detail={data.blockReasonDetail}
        />
      )}

      {advisory && (
        <div className="space-y-4">
          <AdvisorySummary advisory={advisory} />
          {currentConfig && (
            <TuningDiffView
              currentConfig={currentConfig}
              suggestedConfig={advisory.suggestedConfig}
              delta={advisory.delta}
            />
          )}
        </div>
      )}

      {submissionError && (
        <p role="alert" className="mt-4 rounded-md border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">
          {submissionError}
        </p>
      )}

      <TuningPanelActions
        confirmDisabled={confirmDisabled}
        isSubmitting={isSubmitting}
        isCommandPending={isCommandPending}
        isBlocked={isBlocked}
        deviceId={deviceId}
        onRequestConfirmation={requestConfirmation}
        onManualRefresh={() => void handleManualRefresh()}
      />

      {confirmOpen && advisory && (
        <ConfirmationDialog
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void handleConfirmSubmit()}
          isSubmitting={isSubmitting}
          config={advisory.suggestedConfig}
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
