'use client'

import { useEffect, useRef, useState } from 'react'

export type TuningSynchronizationStatus = 'PENDING' | 'IN_SYNC' | 'REJECTED'

export interface TuningStatusSnapshot {
  lamp_gain_scale: number
  mist_gain_scale: number
  mist_on_threshold: number
  mist_off_threshold: number
}

/** A validated durable state transition delivered by the tuning SSE stream. */
export interface TuningStatusEvent {
  id: string
  deviceId: string
  commandId: string
  revision: number
  status: TuningSynchronizationStatus
  config: TuningStatusSnapshot
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface UseTuningStatusResult {
  event: TuningStatusEvent | null
  isConnected: boolean
  error: Error | null
}

type Refetch = () => void | Promise<void>

interface StreamTicketResponse {
  ticket: string
  expiresInSeconds: number
}

const INITIAL_RECONNECT_DELAY_MS = 500
const MAX_RECONNECT_DELAY_MS = 10_000

/**
 * Keeps one device-scoped connection to the durable tuning-state stream.
 * A reconnect obtains a fresh, one-time EventSource ticket and refreshes the
 * caller's durable snapshot exactly once after the stream opens again.
 */
export function useTuningStatus(
  deviceId: string | null | undefined,
  refetch: Refetch,
): UseTuningStatusResult {
  const [event, setEvent] = useState<TuningStatusEvent | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const refetchRef = useRef<Refetch>(refetch)

  useEffect(() => {
    refetchRef.current = refetch
  }, [refetch])

  useEffect(() => {
    if (!deviceId) {
      setEvent(null)
      setIsConnected(false)
      setError(null)
      return
    }

    let disposed = false
    let source: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let ticketRequest: AbortController | null = null
    let reconnectAttempt = 0
    let hasOpened = false
    let reconnectScheduled = false

    setEvent(null)
    setIsConnected(false)
    setError(null)

    const closeSource = () => {
      if (source) {
        source.close()
        source = null
      }
    }

    const scheduleReconnect = () => {
      if (disposed || reconnectScheduled) return

      reconnectScheduled = true
      const delay = Math.min(
        INITIAL_RECONNECT_DELAY_MS * 2 ** reconnectAttempt,
        MAX_RECONNECT_DELAY_MS,
      )
      reconnectAttempt += 1
      retryTimer = setTimeout(() => {
        retryTimer = null
        reconnectScheduled = false
        void connect()
      }, delay)
    }

    const connect = async (): Promise<void> => {
      ticketRequest?.abort()
      closeSource()
      setIsConnected(false)

      const controller = new AbortController()
      ticketRequest = controller

      try {
        const response = await fetch(
          `/api/backend/devices/${encodeURIComponent(deviceId)}/tuning-configurations/stream-ticket`,
          {
            method: 'POST',
            cache: 'no-store',
            signal: controller.signal,
          },
        )
        if (!response.ok) {
          throw new Error(
            `Không thể mở luồng trạng thái tinh chỉnh (HTTP ${response.status}).`,
          )
        }

        const ticket = parseStreamTicket(await response.json())
        if (disposed || controller.signal.aborted) return

        const url = new URL(
          `/api/backend/devices/${encodeURIComponent(deviceId)}/tuning-configurations/stream`,
          window.location.origin,
        )
        url.searchParams.set('ticket', ticket.ticket)

        const nextSource = new EventSource(url.toString())
        source = nextSource
        nextSource.onopen = () => {
          if (disposed || source !== nextSource) return

          const wasReconnect = hasOpened
          hasOpened = true
          reconnectAttempt = 0
          setIsConnected(true)
          setError(null)

          if (wasReconnect) {
            void Promise.resolve(refetchRef.current()).catch(() => {
              // The advisory hook owns and renders its own fetch errors.
            })
          }
        }
        nextSource.onmessage = (message) => {
          if (disposed || source !== nextSource) return

          const parsed = parseTuningStatusEvent(message.data)
          if (!parsed || parsed.deviceId !== deviceId) return
          setEvent(parsed)
        }
        nextSource.onerror = () => {
          if (disposed || source !== nextSource) return

          closeSource()
          setIsConnected(false)
          setError(new Error('Luồng trạng thái tinh chỉnh đã bị ngắt.'))
          scheduleReconnect()
        }
      } catch (cause: unknown) {
        if (disposed || controller.signal.aborted) return

        setIsConnected(false)
        setError(
          cause instanceof Error
            ? cause
            : new Error('Không thể mở luồng trạng thái tinh chỉnh.'),
        )
        scheduleReconnect()
      } finally {
        if (ticketRequest === controller) ticketRequest = null
      }
    }

    void connect()

    return () => {
      disposed = true
      ticketRequest?.abort()
      closeSource()
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [deviceId])

  return { event, isConnected, error }
}

function parseStreamTicket(value: unknown): StreamTicketResponse {
  if (!isRecord(value) || typeof value.ticket !== 'string' || !value.ticket) {
    throw new Error('Máy chủ trả về ticket luồng không hợp lệ.')
  }
  if (
    typeof value.expiresInSeconds !== 'number' ||
    !Number.isSafeInteger(value.expiresInSeconds) ||
    value.expiresInSeconds <= 0
  ) {
    throw new Error('Máy chủ trả về thời hạn ticket không hợp lệ.')
  }
  return { ticket: value.ticket, expiresInSeconds: value.expiresInSeconds }
}

function parseTuningStatusEvent(value: unknown): TuningStatusEvent | null {
  if (typeof value !== 'string') return null

  try {
    const decoded: unknown = JSON.parse(value)
    const payload = isRecord(decoded) && isRecord(decoded.data) ? decoded.data : decoded
    if (!isRecord(payload) || !isTuningStatus(payload.status)) return null
    if (
      typeof payload.id !== 'string' ||
      typeof payload.deviceId !== 'string' ||
      typeof payload.commandId !== 'string' ||
      !isFiniteNumber(payload.revision) ||
      !isTuningSnapshot(payload.config) ||
      !isNullableString(payload.publishedAt) ||
      typeof payload.createdAt !== 'string' ||
      typeof payload.updatedAt !== 'string'
    ) {
      return null
    }

    return {
      id: payload.id,
      deviceId: payload.deviceId,
      commandId: payload.commandId,
      revision: payload.revision,
      status: payload.status,
      config: payload.config,
      publishedAt: payload.publishedAt,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    }
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isTuningStatus(value: unknown): value is TuningSynchronizationStatus {
  return value === 'PENDING' || value === 'IN_SYNC' || value === 'REJECTED'
}

function isTuningSnapshot(value: unknown): value is TuningStatusSnapshot {
  return (
    isRecord(value) &&
    isFiniteNumber(value.lamp_gain_scale) &&
    isFiniteNumber(value.mist_gain_scale) &&
    isFiniteNumber(value.mist_on_threshold) &&
    isFiniteNumber(value.mist_off_threshold)
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}
