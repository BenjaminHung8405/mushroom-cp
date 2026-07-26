'use client'

import { CheckCircle2, LoaderCircle, SlidersHorizontal } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  type TuningAdvisory,
  type TuningConfigSnapshot,
  useTuningRecommendation,
} from '@/app/hooks/useTuningRecommendation'
import { useTuningStatus } from '@/app/hooks/useTuningStatus'
import {
  TuningStatusBadge,
  type TuningCommandState,
} from '@/app/components/tuning/TuningStatusBadge'

interface PendingCommand {
  commandId: string
  state: TuningCommandState
  rejectionReason: string | null
}

interface CreateCommandResponse {
  commandId: string
  status: 'PENDING'
}

interface TuningAdvisoryPanelProps {
  deviceId: string | null | undefined
}

const COMMAND_CONFIRMATION_TIMEOUT_MS = 30_000

/**
 * Presents a server-generated tuning recommendation and submits it only after
 * the operator explicitly confirms it. A 202 merely establishes a pending
 * command; terminal UI state is driven solely by a matching durable SSE event.
 */
export function TuningAdvisoryPanel({ deviceId }: TuningAdvisoryPanelProps) {
  const { data, isLoading, error, refetch } = useTuningRecommendation(deviceId)
  const { event: tuningEvent } = useTuningStatus(deviceId, refetch)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null)

  const advisory = data?.advisory ?? null
  const isBlocked = !deviceId || data?.blockReason !== null || advisory === null
  const isCommandPending = pendingCommand?.state === 'PENDING'
  const confirmDisabled = isBlocked || isSubmitting || isCommandPending

  useEffect(() => {
    setConfirmOpen(false)
    setIsSubmitting(false)
    setSubmissionError(null)
    setPendingCommand(null)
  }, [deviceId])

  useEffect(() => {
    if (!pendingCommand || !tuningEvent) return
    if (tuningEvent.commandId !== pendingCommand.commandId) return

    if (tuningEvent.status === 'IN_SYNC' && pendingCommand.state !== 'IN_SYNC') {
      setPendingCommand({
        commandId: pendingCommand.commandId,
        state: 'IN_SYNC',
        rejectionReason: null,
      })
    } else if (tuningEvent.status === 'REJECTED' && pendingCommand.state !== 'REJECTED') {
      setPendingCommand({
        commandId: pendingCommand.commandId,
        state: 'REJECTED',
        rejectionReason: 'Thiết bị đã từ chối cấu hình được đề xuất.',
      })
    } else if (
      tuningEvent.status === 'PENDING' &&
      pendingCommand.state === 'PENDING'
    ) {
      setPendingCommand((current) =>
        current?.commandId === tuningEvent.commandId
          ? { ...current, state: 'PENDING' }
          : current,
      )
    }
  }, [pendingCommand, tuningEvent])

  useEffect(() => {
    if (!pendingCommand || pendingCommand.state !== 'PENDING') return

    const timeout = window.setTimeout(() => {
      setPendingCommand((current) =>
        current?.commandId === pendingCommand.commandId && current.state === 'PENDING'
          ? { ...current, state: 'TIMEOUT' }
          : current,
      )
    }, COMMAND_CONFIRMATION_TIMEOUT_MS)

    return () => window.clearTimeout(timeout)
  }, [pendingCommand])

  const requestConfirmation = () => {
    if (confirmDisabled) return
    setSubmissionError(null)
    setConfirmOpen(true)
  }

  const submitRecommendation = async () => {
    if (!deviceId || !advisory || confirmDisabled) return

    const commandId = createCommandId()
    if (!commandId) {
      setSubmissionError('Trình duyệt không hỗ trợ tạo mã lệnh an toàn.')
      return
    }

    setIsSubmitting(true)
    setSubmissionError(null)

    try {
      const response = await fetch(
        `/api/backend/devices/${encodeURIComponent(deviceId)}/tuning-configurations`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ commandId, config: advisory.suggestedConfig }),
        },
      )

      if (!response.ok) {
        throw new Error(`Không thể tạo lệnh tinh chỉnh (HTTP ${response.status}).`)
      }

      const result = parseCreateCommandResponse(await response.json())
      if (!result || result.commandId !== commandId) {
        throw new Error('Máy chủ trả về xác nhận lệnh không hợp lệ.')
      }

      // HTTP 202 is not device success. It only lets the panel wait for the
      // durable, command-scoped SSE transition.
      setPendingCommand({ commandId, state: 'PENDING', rejectionReason: null })
      setConfirmOpen(false)
    } catch (cause: unknown) {
      setSubmissionError(
        cause instanceof Error ? cause.message : 'Không thể tạo lệnh tinh chỉnh.',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card className="border border-slate-700/50 bg-slate-950/40 p-6">
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

      {isLoading && !data && (
        <p className="text-sm text-muted-foreground">Đang phân tích dữ liệu vận hành…</p>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">
          {error.message}
        </p>
      )}

      {data?.blockReason && (
        <p role="alert" className="rounded-md border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100">
          <strong>Không thể tạo đề xuất:</strong>{' '}
          {data.blockReasonDetail ?? blockReasonLabel(data.blockReason)}
        </p>
      )}

      {advisory && (
        <AdvisorySummary advisory={advisory} />
      )}

      {submissionError && (
        <p role="alert" className="mt-4 rounded-md border border-red-500/30 bg-red-950/20 p-3 text-sm text-red-200">
          {submissionError}
        </p>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={requestConfirmation} disabled={confirmDisabled}>
          {isSubmitting || isCommandPending ? (
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          ) : (
            <CheckCircle2 aria-hidden="true" />
          )}
          Xác nhận áp dụng
        </Button>
        <Button variant="outline" onClick={() => void refetch()} disabled={!deviceId || isSubmitting}>
          Làm mới đề xuất
        </Button>
        {(isBlocked || isCommandPending) && (
          <span className="text-xs text-muted-foreground">
            {isCommandPending ? 'Đang chờ thiết bị phản hồi.' : 'Xác nhận bị khóa cho đến khi đủ điều kiện.'}
          </span>
        )}
      </div>

      {confirmOpen && advisory && (
        <ConfirmationDialog
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void submitRecommendation()}
          isSubmitting={isSubmitting}
          config={advisory.suggestedConfig}
        />
      )}
    </Card>
  )
}

function AdvisorySummary({ advisory }: { advisory: TuningAdvisory }) {
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

function ConfirmationDialog({
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

function ConfigPreview({ config }: { config: TuningConfigSnapshot }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 rounded-md bg-slate-900/60 p-3 text-xs">
      <dt className="text-muted-foreground">Lamp gain</dt><dd className="text-right font-mono text-slate-100">{config.lamp_gain_scale.toFixed(2)}</dd>
      <dt className="text-muted-foreground">Mist gain</dt><dd className="text-right font-mono text-slate-100">{config.mist_gain_scale.toFixed(2)}</dd>
      <dt className="text-muted-foreground">Mist ON</dt><dd className="text-right font-mono text-slate-100">{config.mist_on_threshold.toFixed(2)}</dd>
      <dt className="text-muted-foreground">Mist OFF</dt><dd className="text-right font-mono text-slate-100">{config.mist_off_threshold.toFixed(2)}</dd>
    </dl>
  )
}

function createCommandId(): string | null {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : null
}

function parseCreateCommandResponse(value: unknown): CreateCommandResponse | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('commandId' in value) ||
    !('status' in value) ||
    typeof value.commandId !== 'string' ||
    value.status !== 'PENDING'
  ) {
    return null
  }
  return { commandId: value.commandId, status: 'PENDING' }
}

function blockReasonLabel(reason: NonNullable<ReturnType<typeof useTuningRecommendation>['data']>['blockReason']): string {
  switch (reason) {
    case 'INSUFFICIENT_DATA': return 'Chưa đủ dữ liệu tin cậy để đề xuất.'
    case 'DEVICE_OFFLINE': return 'Không thể xác nhận thiết bị đang trực tuyến.'
    case 'NO_SUGGESTION': return 'Dữ liệu hiện tại không cần thay đổi cấu hình.'
    case 'CONFLICT': return 'Các quy tắc đề xuất đang mâu thuẫn.'
    case null: return ''
  }
}
