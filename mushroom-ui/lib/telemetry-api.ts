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
  heaterAirActive: boolean | null
  heaterWaterActive: boolean | null
  middayBlackoutActive: boolean | null
}

export interface DeviceStatusEvent {
  deviceId: string
  status: 'online' | 'offline'
  timestamp: string
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

/** Default monitored device ID — must match EMQX MQTT username. */
export const DEFAULT_DEVICE_ID =
  process.env.NEXT_PUBLIC_DEVICE_ID ?? 'esp32_mushroom_s3_01'

// ── Snapshot ────────────────────────────────────────────────────────

export async function fetchTelemetrySnapshot(
  deviceId: string,
): Promise<TelemetrySnapshot | null> {
  try {
    const res = await fetch(`${API_BASE}/devices/${deviceId}/telemetry`)
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
      `${API_BASE}/devices/${deviceId}/telemetry/history`,
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
    `${API_BASE}/devices/${deviceId}/telemetry/stream`,
  )

  es.addEventListener('message', (ev: MessageEvent) => {
    try {
      handler(JSON.parse(ev.data) as TelemetrySnapshot)
    } catch {
      console.warn('[telemetry-api] bad SSE message:', ev.data)
    }
  })

  es.onerror = () => {
    // Browser auto-reconnects; no action needed.
  }

  return () => {
    es.close()
  }
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

  es.onerror = () => {
    // Browser auto-reconnects.
  }

  return () => {
    es.close()
  }
}