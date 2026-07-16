/**
 * Typed API client for real telemetry data from NestJS backend.
 *
 * Endpoints:
 *   GET  /devices/:id/telemetry            — latest snapshot
 *   SSE  /devices/:id/telemetry/stream      — live telemetry updates
 *   GET  /devices/:id/telemetry/history     — downsampled history
 *   GET  /devices/:id/status               — online/offline LWT status
 *   SSE  /devices/status/stream             — all-device LWT events
 */

export interface ManualAckState {
  channel: 0 | 1 | 2
  requested_intent: 'on' | 'off' | 'auto'
  decision: number
  effective_intent: 'on' | 'off' | 'auto'
  release_reason: 'ttl_expired' | 'safety_limit_reached' | 'hardware_protection' | null
  /** Browser-wall-clock expiry timestamp, or null when no manual latch remains. */
  expires_ms: number | null
  ack_ms: number
}

export interface TelemetrySnapshot {
  deviceId: string
  houseId: string
  time: string
  batchId: string | null
  cropDayInt: number
  humidityMeasured: number | null
  temperatureMeasured: number | null
  co2Measured: number | null
  humiditySetpoint: number | null
  temperatureSetpoint: number | null
  humidityErrorDelta: number | null
  temperatureErrorDelta: number | null
  mistGeneratorActive: boolean | null
  convectionFanActive: boolean | null
  lampStageActive: boolean | null
  lampStage2Active: boolean | null
  heaterWaterActive: boolean | null
  middayBlackoutActive: boolean | null
  mistAck: ManualAckState | null
  fanAck: ManualAckState | null
  lampAck: ManualAckState | null
  operatingMode: 'AI' | 'MANUAL'
}

export interface OperatingModeEvent {
  deviceId: string
  mode: 'AI' | 'MANUAL'
  timestamp: string
}

export interface DeviceStatusEvent {
  deviceId: string
  status: 'online' | 'offline'
  timestamp: string
}

const API_BASE = '/api/backend'

// ── Snapshot ────────────────────────────────────────────────────────

export async function fetchTelemetrySnapshot(
  deviceId: string,
): Promise<TelemetrySnapshot | null> {
  try {
    const res = await fetch(`${API_BASE}/devices/${encodeURIComponent(deviceId)}/telemetry`)
    if (!res.ok) return null
    return (await res.json()) as TelemetrySnapshot
  } catch {
    return null
  }
}

// ── History (bucketed) ──────────────────────────────────────────────

export type BucketSize =
  | '1 minute'
  | '5 minutes'
  | '15 minutes'
  | '1 hour'
  | '1 day'

export async function fetchTelemetryHistory(
  deviceId: string,
  from: Date,
  to: Date,
  bucket: BucketSize = '5 minutes',
): Promise<TelemetrySnapshot[]> {
  try {
    const url = new URL(
      `${API_BASE}/devices/${encodeURIComponent(deviceId)}/telemetry/history`,
      window.location.origin,
    )
    url.searchParams.set('from', from.toISOString())
    url.searchParams.set('to', to.toISOString())
    url.searchParams.set('bucket', bucket)

    const res = await fetch(url.toString())
    if (!res.ok) return []
    return (await res.json()) as TelemetrySnapshot[]
  } catch {
    return []
  }
}

// ── SSE helpers ─────────────────────────────────────────────────────

type EventHandler<T> = (event: T) => void

export function subscribeTelemetryStream(
  deviceId: string,
  handler: EventHandler<TelemetrySnapshot>,
): () => void {
  const es = new EventSource(
    `${API_BASE}/devices/${encodeURIComponent(deviceId)}/telemetry/stream`,
  )

  es.addEventListener('message', (ev: MessageEvent) => {
    try {
      handler(JSON.parse(ev.data) as TelemetrySnapshot)
    } catch {
      console.warn('[telemetry-api] bad SSE message:', ev.data)
    }
  })

  es.onerror = () => {}

  return () => es.close()
}

export function subscribeDeviceStatusStream(
  handler: EventHandler<DeviceStatusEvent>,
): () => void {
  const es = new EventSource(`${API_BASE}/devices/status/stream`)

  es.addEventListener('device-status', (ev: MessageEvent) => {
    try {
      handler(JSON.parse(ev.data) as DeviceStatusEvent)
    } catch {
      console.warn('[telemetry-api] bad device-status SSE:', ev.data)
    }
  })

  es.onerror = () => {}

  return () => es.close()
}

/**
 * POST /api/backend/devices/:id/operating-mode — switches AI ↔ MANUAL.
 * Returns immediately; firmware persists and publishes full snapshot shortly.
 */
export async function postSetOperatingMode(
  deviceId: string,
  mode: 'AI' | 'MANUAL',
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/devices/${encodeURIComponent(deviceId)}/operating-mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
    if (!res.ok) {
      const errData = (await res.json()) as { message?: string }
      return { success: false, message: errData.message ?? 'Không thể thay đổi chế độ vận hành.' }
    }
    return { success: true, message: `Chế độ đã chuyển sang ${mode}.` }
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? 'Lỗi kết nối đến máy chủ.'
    return { success: false, message: msg }
  }
}

export async function postActuatorOverride(
  deviceId: string,
  actuator: 'fan' | 'heater_air' | 'lamp' | 'lamp_stage' | 'mist',
  state: boolean | null,
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/devices/${encodeURIComponent(deviceId)}/actuator-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actuator, state }),
    })

    if (!res.ok) {
      const errData = (await res.json()) as { message?: string }
      return {
        success: false,
        message: errData.message ?? 'Không thể gửi lệnh ghi đè thiết bị.',
      }
    }

    return { success: true, message: 'Lệnh ghi đè đã được gửi thành công.' }
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? 'Lỗi kết nối đến máy chủ.'
    return { success: false, message: msg }
  }
}

/**
 * Device configuration-synchronisation helpers — reads the live /config-sync
 * endpoint and exposes a thin publish method that matches backend contracts.
 */

import { ConfigSyncEvent } from './types'

export async function fetchConfigSync(deviceId: string): Promise<ConfigSyncEvent | null> {
  try {
    const res = await fetch(`${API_BASE}/devices/${encodeURIComponent(deviceId)}/config-sync`)
    if (!res.ok) return null
    return (await res.json()) as ConfigSyncEvent
  } catch { return null }
}

export function subscribeConfigSyncStream(
  deviceId: string, handler: EventHandler<ConfigSyncEvent>,
): () => void {
  const es = new EventSource(`${API_BASE}/devices/${encodeURIComponent(deviceId)}/config-sync/stream`)
  es.addEventListener('message', (ev: MessageEvent) => {
    try { handler(JSON.parse(ev.data) as ConfigSyncEvent) }
    catch { console.warn('[config-sync] bad SSE:', ev.data) }
  })
  es.onerror = () => {}
  return () => es.close()
}

export async function postApplyCropProfile(
  deviceId: string, payload: {
    cropStartEpochSec: number
    totalCropDays: number
    checkpoints: Array<{ cropDay: number; temperatureCelsius: number; humidityPercent: number }>
    configRevision?: number
  },
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/devices/${encodeURIComponent(deviceId)}/apply-crop-profile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const errData = (await res.json()) as { message?: string };
      return { success: false, message: errData?.message ?? 'Không thể gửi crop profile.' }
    }
    return { success: true, message: 'Đang đồng bộ crop profile xuống thiết bị.' }
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? 'Lỗi kết nối đến máy chủ.'
    return { success: false, message: msg }
  }
}
