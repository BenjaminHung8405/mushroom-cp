'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TuningConfigSnapshot } from '@/app/lib/tuning-schema'
import type { TuningStatusEvent } from '@/app/hooks/useTuningStatus'
import type { TuningCommandState } from '@/app/components/tuning/TuningStatusBadge'

export interface PendingCommand {
  commandId: string
  deviceId: string
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
      deviceId: currentPending.deviceId,
      state: 'IN_SYNC',
      rejectionReason: null,
    }
  }
  if (latest.status === 'REJECTED') {
    return {
      commandId: currentPending.commandId,
      deviceId: currentPending.deviceId,
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
      deviceId: currentPending.deviceId,
      state: 'PENDING',
      rejectionReason: null,
    }
  }
  return null
}

function useDurableStateReconciler(
  deviceId: string | null | undefined,
  pendingCommandRef: React.RefObject<PendingCommand | null>,
  setPendingCommand: React.Dispatch<React.SetStateAction<PendingCommand | null>>,
) {
  return useCallback(async () => {
    const currentPending = pendingCommandRef.current
    if (
      !deviceId ||
      !currentPending ||
      currentPending.deviceId !== deviceId ||
      (currentPending.state !== 'PENDING' && currentPending.state !== 'TIMEOUT')
    ) {
      return
    }

    const latest = await fetchLatestState(deviceId)
    if (!latest) return

    if (
      pendingCommandRef.current?.commandId !== currentPending.commandId ||
      pendingCommandRef.current?.deviceId !== deviceId
    ) {
      return
    }

    const updated = applyDurableState(latest, currentPending)
    if (updated && (updated.state !== currentPending.state || updated.rejectionReason !== currentPending.rejectionReason)) {
      setPendingCommand(updated)
    }
  }, [deviceId, pendingCommandRef, setPendingCommand])
}

function useSseEventReconciler(
  deviceId: string | null | undefined,
  pendingCommand: PendingCommand | null,
  tuningEvent: TuningStatusEvent | null,
  setPendingCommand: React.Dispatch<React.SetStateAction<PendingCommand | null>>,
) {
  useEffect(() => {
    if (!deviceId || !pendingCommand || !tuningEvent) return
    if (pendingCommand.deviceId !== deviceId || tuningEvent.deviceId !== deviceId) return
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
  }, [deviceId, pendingCommand, tuningEvent, setPendingCommand])
}

function usePendingTimeout(
  pendingCommand: PendingCommand | null,
  setPendingCommand: React.Dispatch<React.SetStateAction<PendingCommand | null>>,
) {
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
  }, [pendingCommand, setPendingCommand])
}

export function createCommandId(): string | null {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : null
}

async function executeCommandSubmission(
  deviceId: string,
  commandId: string,
  config: TuningConfigSnapshot,
  currentDeviceIdRef: React.RefObject<string | null | undefined>,
  setPendingCommand: React.Dispatch<React.SetStateAction<PendingCommand | null>>,
): Promise<void> {
  const result = await postPendingCommand(deviceId, commandId, config)
  if (result.commandId !== commandId) {
    throw new Error('Máy chủ trả về xác nhận lệnh không hợp lệ.')
  }

  if (currentDeviceIdRef.current !== deviceId) return

  const pending: PendingCommand = {
    commandId,
    deviceId,
    state: 'PENDING',
    rejectionReason: null,
  }
  setPendingCommand(pending)

  const latest = await fetchLatestState(deviceId)
  if (latest && latest.commandId === commandId && currentDeviceIdRef.current === deviceId) {
    const updated = applyDurableState(latest, pending)
    if (updated && updated.state !== 'PENDING') {
      setPendingCommand(updated)
    }
  }
}

function useSubmitRecommendation(
  deviceId: string | null | undefined,
  currentDeviceIdRef: React.RefObject<string | null | undefined>,
  setPendingCommand: React.Dispatch<React.SetStateAction<PendingCommand | null>>,
  setIsSubmitting: React.Dispatch<React.SetStateAction<boolean>>,
  setSubmissionError: React.Dispatch<React.SetStateAction<string | null>>,
) {
  return useCallback(
    async (config: TuningConfigSnapshot): Promise<boolean> => {
      if (!deviceId || deviceId !== currentDeviceIdRef.current) return false
      const commandId = createCommandId()
      if (!commandId) {
        setSubmissionError('Trình duyệt không hỗ trợ tạo mã lệnh an toàn.')
        return false
      }

      setIsSubmitting(true)
      setSubmissionError(null)

      try {
        await executeCommandSubmission(
          deviceId,
          commandId,
          config,
          currentDeviceIdRef,
          setPendingCommand,
        )
        return true
      } catch (cause: unknown) {
        const msg = cause instanceof Error ? cause.message : 'Không thể tạo lệnh tinh chỉnh.'
        setSubmissionError(msg)
        return false
      } finally {
        setIsSubmitting(false)
      }
    },
    [deviceId, currentDeviceIdRef, setPendingCommand, setIsSubmitting, setSubmissionError],
  )
}

function usePendingStateSync(
  deviceId: string | null | undefined,
  pendingCommand: PendingCommand | null,
  setPendingCommand: React.Dispatch<React.SetStateAction<PendingCommand | null>>,
  setIsSubmitting: React.Dispatch<React.SetStateAction<boolean>>,
  setSubmissionError: React.Dispatch<React.SetStateAction<string | null>>,
) {
  const currentDeviceIdRef = useRef<string | null | undefined>(deviceId)
  useEffect(() => {
    currentDeviceIdRef.current = deviceId
  }, [deviceId])

  const pendingCommandRef = useRef<PendingCommand | null>(pendingCommand)
  useEffect(() => {
    pendingCommandRef.current = pendingCommand
  }, [pendingCommand])

  useEffect(() => {
    setPendingCommand(null)
    setIsSubmitting(false)
    setSubmissionError(null)
  }, [deviceId, setPendingCommand, setIsSubmitting, setSubmissionError])

  return { currentDeviceIdRef, pendingCommandRef }
}

export function usePendingTuningCommand(
  deviceId: string | null | undefined,
  tuningEvent: TuningStatusEvent | null,
): UsePendingTuningCommandResult {
  const [pendingCommand, setPendingCommand] = useState<PendingCommand | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submissionError, setSubmissionError] = useState<string | null>(null)

  const { currentDeviceIdRef, pendingCommandRef } = usePendingStateSync(
    deviceId,
    pendingCommand,
    setPendingCommand,
    setIsSubmitting,
    setSubmissionError,
  )

  const resyncDurableState = useDurableStateReconciler(deviceId, pendingCommandRef, setPendingCommand)
  useSseEventReconciler(deviceId, pendingCommand, tuningEvent, setPendingCommand)
  usePendingTimeout(pendingCommand, setPendingCommand)

  const submitRecommendation = useSubmitRecommendation(
    deviceId,
    currentDeviceIdRef,
    setPendingCommand,
    setIsSubmitting,
    setSubmissionError,
  )
  const resetPendingCommand = useCallback(() => {
    setPendingCommand(null)
  }, [])

  const safePendingCommand =
    pendingCommand && deviceId && pendingCommand.deviceId === deviceId ? pendingCommand : null

  return {
    pendingCommand: safePendingCommand,
    isSubmitting,
    submissionError,
    setSubmissionError,
    submitRecommendation,
    resyncDurableState,
    resetPendingCommand,
  }
}

export function parseCreateCommandResponse(value: unknown): CreateCommandResponse | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('commandId' in value) ||
    !('status' in value) ||
    typeof value.commandId !== 'string' ||
    !value.commandId.trim() ||
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
    !rec.commandId.trim() ||
    (rec.status !== 'PENDING' && rec.status !== 'IN_SYNC' && rec.status !== 'REJECTED')
  ) {
    return null
  }

  let rejectionReason: string | null = null
  if (rec.rejectionReason !== null && rec.rejectionReason !== undefined) {
    if (typeof rec.rejectionReason !== 'string' || rec.rejectionReason.length > 500) {
      return null
    }
    rejectionReason = rec.rejectionReason
  }

  return {
    commandId: rec.commandId,
    status: rec.status,
    rejectionReason,
  }
}
