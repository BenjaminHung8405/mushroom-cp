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
  rejectionReason: string | null
}

export interface UseTuningStatusResult {
  event: TuningStatusEvent | null
  isConnected: boolean
  error: Error | null
}

type Refetch = () => void | Promise<void>

export interface StreamTicketResponse {
  ticket: string
  expiresInSeconds: number
}

const INITIAL_RECONNECT_DELAY_MS = 500
const MAX_RECONNECT_DELAY_MS = 10_000

export function calculateBackoffDelay(attempt: number): number {
  return Math.min(
    INITIAL_RECONNECT_DELAY_MS * 2 ** attempt,
    MAX_RECONNECT_DELAY_MS,
  )
}

export async function fetchStreamTicket(
  deviceId: string,
  signal: AbortSignal,
): Promise<StreamTicketResponse> {
  const response = await fetch(
    `/api/backend/devices/${encodeURIComponent(deviceId)}/tuning-configurations/stream-ticket`,
    {
      method: 'POST',
      cache: 'no-store',
      signal,
    },
  )
  if (!response.ok) {
    throw new Error(
      `Không thể mở luồng trạng thái tinh chỉnh (HTTP ${response.status}).`,
    )
  }
  return parseStreamTicket(await response.json())
}

export function buildStreamUrl(deviceId: string, ticket: string): string {
  const url = new URL(
    `/api/backend/devices/${encodeURIComponent(deviceId)}/tuning-configurations/stream`,
    window.location.origin,
  )
  url.searchParams.set('ticket', ticket)
  return url.toString()
}

interface ConnectionState {
  disposed: boolean
  source: EventSource | null
  retryTimer: ReturnType<typeof setTimeout> | null
  ticketRequest: AbortController | null
  reconnectAttempt: number
  hasOpened: boolean
  reconnectScheduled: boolean
}

function closeEventSource(state: ConnectionState): void {
  if (state.source) {
    state.source.close()
    state.source = null
  }
}

export function cleanupConnectionState(state: ConnectionState): void {
  state.disposed = true
  state.ticketRequest?.abort()
  closeEventSource(state)
  if (state.retryTimer) clearTimeout(state.retryTimer)
}

function scheduleReconnect(
  deviceId: string,
  state: ConnectionState,
  onReconnectRef: React.RefObject<Refetch | undefined>,
  setEvent: (ev: TuningStatusEvent | null) => void,
  setIsConnected: (connected: boolean) => void,
  setError: (err: Error | null) => void,
): void {
  if (state.disposed || state.reconnectScheduled) return

  state.reconnectScheduled = true
  const delay = calculateBackoffDelay(state.reconnectAttempt)
  state.reconnectAttempt += 1
  state.retryTimer = setTimeout(() => {
    state.retryTimer = null
    state.reconnectScheduled = false
    void connectStream(
      deviceId,
      state,
      onReconnectRef,
      setEvent,
      setIsConnected,
      setError,
    )
  }, delay)
}

function handleConnectError(
  cause: unknown,
  deviceId: string,
  state: ConnectionState,
  onReconnectRef: React.RefObject<Refetch | undefined>,
  setEvent: (ev: TuningStatusEvent | null) => void,
  setIsConnected: (connected: boolean) => void,
  setError: (err: Error | null) => void,
): void {
  setIsConnected(false)
  setError(
    cause instanceof Error
      ? cause
      : new Error('Không thể mở luồng trạng thái tinh chỉnh.'),
  )
  scheduleReconnect(
    deviceId,
    state,
    onReconnectRef,
    setEvent,
    setIsConnected,
    setError,
  )
}

async function connectStream(
  deviceId: string,
  state: ConnectionState,
  onReconnectRef: React.RefObject<Refetch | undefined>,
  setEvent: (ev: TuningStatusEvent | null) => void,
  setIsConnected: (connected: boolean) => void,
  setError: (err: Error | null) => void,
): Promise<void> {
  state.ticketRequest?.abort()
  closeEventSource(state)
  setIsConnected(false)

  const controller = new AbortController()
  state.ticketRequest = controller

  try {
    const ticket = await fetchStreamTicket(deviceId, controller.signal)
    if (state.disposed || controller.signal.aborted) return

    const streamUrl = buildStreamUrl(deviceId, ticket.ticket)
    const nextSource = new EventSource(streamUrl)
    state.source = nextSource
    setupEventSourceHandlers(
      nextSource,
      deviceId,
      state,
      onReconnectRef,
      setEvent,
      setIsConnected,
      setError,
    )
  } catch (cause: unknown) {
    if (state.disposed || controller.signal.aborted) return
    handleConnectError(cause, deviceId, state, onReconnectRef, setEvent, setIsConnected, setError)
  } finally {
    if (state.ticketRequest === controller) state.ticketRequest = null
  }
}

function setupEventSourceHandlers(
  nextSource: EventSource,
  deviceId: string,
  state: ConnectionState,
  onReconnectRef: React.RefObject<Refetch | undefined>,
  setEvent: (ev: TuningStatusEvent | null) => void,
  setIsConnected: (connected: boolean) => void,
  setError: (err: Error | null) => void,
): void {
  nextSource.onopen = () => {
    if (state.disposed || state.source !== nextSource) return
    const wasReconnect = state.hasOpened
    state.hasOpened = true
    state.reconnectAttempt = 0
    setIsConnected(true)
    setError(null)

    if (wasReconnect && onReconnectRef.current) {
      void Promise.resolve(onReconnectRef.current()).catch(() => {})
    }
  }

  nextSource.onmessage = (message) => {
    if (state.disposed || state.source !== nextSource) return
    const parsed = parseTuningStatusEvent(message.data)
    if (!parsed || parsed.deviceId !== deviceId) return
    setEvent(parsed)
  }

  nextSource.onerror = () => {
    if (state.disposed || state.source !== nextSource) return
    closeEventSource(state)
    setIsConnected(false)
    setError(new Error('Luồng trạng thái tinh chỉnh đã bị ngắt.'))
    scheduleReconnect(
      deviceId,
      state,
      onReconnectRef,
      setEvent,
      setIsConnected,
      setError,
    )
  }
}

function startConnectionLoop(
  deviceId: string,
  state: ConnectionState,
  onReconnectRef: React.RefObject<Refetch | undefined>,
  setEvent: (ev: TuningStatusEvent | null) => void,
  setIsConnected: (connected: boolean) => void,
  setError: (err: Error | null) => void,
): void {
  void connectStream(
    deviceId,
    state,
    onReconnectRef,
    setEvent,
    setIsConnected,
    setError,
  )
}

function createInitialConnectionState(): ConnectionState {
  return {
    disposed: false,
    source: null,
    retryTimer: null,
    ticketRequest: null,
    reconnectAttempt: 0,
    hasOpened: false,
    reconnectScheduled: false,
  }
}

/**
 * Keeps one device-scoped connection to the durable tuning-state stream.
 * A reconnect obtains a fresh, one-time EventSource ticket and refreshes the
 * caller's durable snapshot and recommendations after the stream opens.
 */
export function useTuningStatus(
  deviceId: string | null | undefined,
  onReconnect?: Refetch,
): UseTuningStatusResult {
  const [event, setEvent] = useState<TuningStatusEvent | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const onReconnectRef = useRef<Refetch | undefined>(onReconnect)

  useEffect(() => {
    onReconnectRef.current = onReconnect
  }, [onReconnect])

  useEffect(() => {
    setEvent(null)
    setIsConnected(false)
    setError(null)
    if (!deviceId) return

    const state = createInitialConnectionState()
    startConnectionLoop(
      deviceId,
      state,
      onReconnectRef,
      setEvent,
      setIsConnected,
      setError,
    )

    return () => cleanupConnectionState(state)
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

export function parseTuningStatusEvent(value: unknown): TuningStatusEvent | null {
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
      typeof payload.updatedAt !== 'string' ||
      !isNullableString(payload.rejectionReason)
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
      rejectionReason: payload.rejectionReason ?? null,
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
