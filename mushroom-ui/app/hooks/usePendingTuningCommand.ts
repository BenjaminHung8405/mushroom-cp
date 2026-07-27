'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TuningConfigSnapshot } from '@/app/lib/tuning-schema'
import type { TuningStatusEvent } from '@/app/hooks/useTuningStatus'
import type { TuningCommandState } from '@/app/components/tuning/TuningStatusBadge'

export interface PendingCommand {
  commandId: string
  state: TuningCommandState
  rejectionReason: string | null
}

export interface CreateCommandResponse {
  commandId: string
  status: 'PENDING'
}

export interface LatestTuningStateResponse {
  commandId: string
  status: 'PENDING' | 'IN_SYNC' | 'REJECTED'
  rejectionReason: string | null
}

const COMMAND_CONFIRMATION_TIMEOUT_MS = 30_000

export interface UsePendingTuningCommandResult {
  pendingCommand: PendingCommand | null
  isSubmitting: boolean
  submissionError: string | null
  setSubmissionError: (error: string | null) => void
  submitRecommendation: (config: TuningConfigSnapshot) => Promise<boolean>
  resyncDurableState: () => Promise<void>
  resetPendingCommand: () => void
}

export async function postPendingCommand(
  deviceId: string,
  commandId: string,
  config: TuningConfigSnapshot,
): Promise<CreateCommandResponse> {
  const response = await fetch(
    `/api/backend/devices/${encodeURIComponent(deviceId)}/tuning-configurations`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId, config }),
    },
  )

  if (!response.ok) {
    throw new Error(`Không thể tạo lệnh tinh chỉnh (HTTP ${response.status}).`)
  }

  const result = parseCreateCommandResponse(await response.json())
  if (!result) {
    throw new Error('Máy chủ trả về xác nhận lệnh không hợp lệ.')
  }
  return result
}

export async function fetchLatestState(
  deviceId: string,
): Promise<LatestTuningStateResponse | null> {
  try {
    const response = await fetch(
      `/api/backend/devices/${encodeURIComponent(deviceId)}/tuning-configurations/latest`,
      {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      },
    )

    if (!response.ok) return null

    const data: unknown = await response.json()
    return parseLatestTuningState(data)
  } catch {
    return null
  }
}

export function applyDurableState(
  latest: LatestTuningStateResponse,
  currentPending: PendingCommand,
): PendingCommand | null {
  if (latest.commandId !== currentPending.commandId) return null

  if (latest.status === 'IN_SYNC') {
    return {
      commandId: currentPending.commandId,
      state: 'IN_SYNC',
      rejectionReason: null,
    }
  }
  if (latest.status === 'REJECTED') {
    return {
      commandId: currentPending.commandId,
      state: 'REJECTED',
      rejectionReason:
        latest.rejectionReason && latest.rejectionReason.trim()
          ? latest.rejectionReason
          : 'Thiết bị đã từ chối cấu hình được đề xuất.',
    }
  }
  if (latest.status === 'PENDING') {
    return {
      commandId: currentPending.commandId,
      state: 'PENDING',
      rejectionReason: null,
    }
  }
  return null
}

export function usePendingTuningCommand(
  deviceId: string | null | undefined,
  tuningEvent: TuningStatusEvent | null,
): UsePendingTuningCommandResult {
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submissionError, setSubmissionError] = useState<string | null>(null)

  const pendingCommandRef = useRef<PendingCommand | null>(pendingCommand)
  useEffect(() => {
    pendingCommandRef.current = pendingCommand
  }, [pendingCommand])

  useEffect(() => {
    setPendingCommand(null)
    setIsSubmitting(false)
    setSubmissionError(null)
  }, [deviceId])

  const resyncDurableState = useCallback(async () => {
    const currentPending = pendingCommandRef.current
    if (!deviceId || !currentPending || currentPending.state !== 'PENDING') {
      return
    }

    const latest = await fetchLatestState(deviceId)
    if (!latest) return

    // Stale guard against device or command change while fetching
    if (pendingCommandRef.current?.commandId !== currentPending.commandId) return

    const updated = applyDurableState(latest, currentPending)
    if (updated && updated.state !== currentPending.state) {
      setPendingCommand(updated)
    }
  }, [deviceId])

  // Process matching SSE events.
  useEffect(() => {
    if (!pendingCommand || !tuningEvent) return
    if (tuningEvent.commandId !== pendingCommand.commandId) return

    const sseLatest: LatestTuningStateResponse = {
      commandId: tuningEvent.commandId,
      status: tuningEvent.status,
      rejectionReason: tuningEvent.rejectionReason,
    }

    const updated = applyDurableState(sseLatest, pendingCommand)
    if (
      updated &&
      (updated.state !== pendingCommand.state ||
        updated.rejectionReason !== pendingCommand.rejectionReason)
    ) {
      setPendingCommand(updated)
    }
  }, [pendingCommand, tuningEvent])

  // Handle 30-second timeout for pending command confirmation.
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

  const submitRecommendation = useCallback(
    async (config: TuningConfigSnapshot): Promise<boolean> => {
      if (!deviceId) return false

      const commandId = createCommandId()
      if (!commandId) {
        setSubmissionError('Trình duyệt không hỗ trợ tạo mã lệnh an toàn.')
        return false
      }

      setIsSubmitting(true)
      setSubmissionError(null)

      try {
        const result = await postPendingCommand(deviceId, commandId, config)
        if (result.commandId !== commandId) {
          throw new Error('Máy chủ trả về xác nhận lệnh không hợp lệ.')
        }

        const initialPending: PendingCommand = {
          commandId,
          state: 'PENDING',
          rejectionReason: null,
        }
        setPendingCommand(initialPending)

        // Immediately check durable state in case completion happened rapidly.
        try {
          const latest = await fetchLatestState(deviceId)
          if (latest && latest.commandId === commandId) {
            const updated = applyDurableState(latest, initialPending)
            if (updated && updated.state !== 'PENDING') {
              setPendingCommand(updated)
            }
          }
        } catch {
          // If check fails, SSE stream and 30s timeout remain active.
        }

        return true
      } catch (cause: unknown) {
        setSubmissionError(
          cause instanceof Error
            ? cause.message
            : 'Không thể tạo lệnh tinh chỉnh.',
        )
        return false
      } finally {
        setIsSubmitting(false)
      }
    },
    [deviceId],
  )

  const resetPendingCommand = useCallback(() => {
    setPendingCommand(null)
  }, [])

  return {
    pendingCommand,
    isSubmitting,
    submissionError,
    setSubmissionError,
    submitRecommendation,
    resyncDurableState,
    resetPendingCommand,
  }
}

function createCommandId(): string | null {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : null
}

export function parseCreateCommandResponse(value: unknown): CreateCommandResponse | null {
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

export function parseLatestTuningState(value: unknown): LatestTuningStateResponse | null {
  if (typeof value !== 'object' || value === null) return null
  const rec = value as Record<string, unknown>
  if (
    typeof rec.commandId !== 'string' ||
    (rec.status !== 'PENDING' && rec.status !== 'IN_SYNC' && rec.status !== 'REJECTED')
  ) {
    return null
  }
  const rejectionReason =
    typeof rec.rejectionReason === 'string'
      ? rec.rejectionReason
      : rec.rejectionReason === null
        ? null
        : null

  return {
    commandId: rec.commandId,
    status: rec.status,
    rejectionReason,
  }
}
