'use client'

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { DeviceStatus } from './simulation-context'
import {
  DEFAULT_DEVICE_ID,
  fetchTelemetrySnapshot,
  subscribeTelemetryStream,
  subscribeDeviceStatusStream,
  type TelemetrySnapshot,
  type DeviceStatusEvent,
} from './telemetry-api'

/**
 * RealTelemetryProvider — live telemetry from NestJS.
 *
 * Reads:
 *   - GET /devices/:id/telemetry
 *   - SSE /devices/:id/telemetry/stream
 *   - SSE /devices/status/stream (LWT online/offline)
 *
 * Display status is composed:
 *   offline > stale (LWT online + telemetry age > 20s) > online > unknown
 */

/** LWT-only status from backend SSE (never includes 'stale'). */
type LwtStatus = 'online' | 'offline' | 'unknown'

const STALE_MS = 20_000
const STALE_TICK_MS = 5_000

function deriveDeviceStatus(
  lwt: LwtStatus,
  lastTelemetryMs: number | null,
  onlineSinceMs: number | null,
  nowMs: number,
): DeviceStatus {
  if (lwt === 'offline') return 'offline'
  if (lwt === 'unknown') return 'unknown'

  const freshnessBaseline = lastTelemetryMs ?? onlineSinceMs
  if (freshnessBaseline === null) return 'online'
  return nowMs - freshnessBaseline > STALE_MS ? 'stale' : 'online'
}

interface RealTelemetryContextType {
  humidityCurrent: number | null
  humidityTrend: number | null
  temperatureCurrent: number | null
  temperatureTrend: number | null
  co2Current: number | null
  co2Trend: number | null

  temperatureSetpoint: number | null
  humiditySetpoint: number | null
  snapshot: TelemetrySnapshot | null
  isLoading: boolean

  fanActive: boolean
  lampActive: boolean
  mistActive: boolean

  deviceStatus: DeviceStatus
  lastTelemetryAt: string | null
  monitoredDeviceId: string
}

const RealTelemetryContext = createContext<RealTelemetryContextType | undefined>(
  undefined,
)

export function RealTelemetryProvider({ children }: { children: React.ReactNode }) {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const prevSnapshotRef = useRef<TelemetrySnapshot | null>(null)

  // LWT truth is never written by the stale path.
  const [lwtStatus, setLwtStatus] = useState<LwtStatus>('unknown')
  const [onlineSinceMs, setOnlineSinceMs] = useState<number | null>(null)

  const lastTelemetryMs = useMemo(() => {
    if (!snapshot?.time) return null
    const ms = new Date(snapshot.time).getTime()
    return Number.isFinite(ms) ? ms : null
  }, [snapshot?.time])

  // Lightweight clock tick that forces freshness re-evaluation without
  // recreating the interval or capturing the snapshot in its callback.
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Initial snapshot
  useEffect(() => {
    let cancelled = false
    fetchTelemetrySnapshot(DEFAULT_DEVICE_ID).then((snap) => {
      if (!cancelled && snap) setSnapshot(snap)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Live telemetry SSE
  useEffect(() => {
    return subscribeTelemetryStream(DEFAULT_DEVICE_ID, (snap) => {
      setSnapshot(snap)
    })
  }, [])

  // LWT status SSE — writes only to lwtStatus; also records when online began.
  useEffect(() => {
    return subscribeDeviceStatusStream((ev: DeviceStatusEvent) => {
      if (ev.deviceId === DEFAULT_DEVICE_ID) {
        setLwtStatus(ev.status)
        if (ev.status === 'online') {
          const timestamp = new Date(ev.timestamp).getTime()
          setOnlineSinceMs(Number.isFinite(timestamp) ? timestamp : Date.now())
        } else {
          setOnlineSinceMs(null)
        }
      }
    })
  }, [])

  // Stale evaluation tick — only advances the clock; derivation is pure.
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now())
    }, STALE_TICK_MS)
    return () => clearInterval(timer)
  }, [])

  const deviceStatus = useMemo(
    () => deriveDeviceStatus(lwtStatus, lastTelemetryMs, onlineSinceMs, nowMs),
    [lwtStatus, lastTelemetryMs, onlineSinceMs, nowMs],
  )

  const humidityCurrent = snapshot?.humidityMeasured ?? null
  const temperatureCurrent = snapshot?.temperatureMeasured ?? null
  const co2Current = snapshot?.co2Measured ?? null
  const isLoading = snapshot === null && lwtStatus === 'unknown'
  const lastTelemetryAt = snapshot?.time ?? null

  const humidityTrend = useMemo(() => {
    if (!prevSnapshotRef.current || !snapshot) return null
    const a = prevSnapshotRef.current.humidityMeasured
    const b = snapshot.humidityMeasured
    if (a === null || b === null) return null
    return Number((b - a).toFixed(1))
  }, [snapshot])

  const temperatureTrend = useMemo(() => {
    if (!prevSnapshotRef.current || !snapshot) return null
    const a = prevSnapshotRef.current.temperatureMeasured
    const b = snapshot.temperatureMeasured
    if (a === null || b === null) return null
    return Number((b - a).toFixed(1))
  }, [snapshot])

  const co2Trend = useMemo(() => {
    if (!prevSnapshotRef.current || !snapshot) return null
    const a = prevSnapshotRef.current.co2Measured
    const b = snapshot.co2Measured
    if (a === null || b === null) return null
    return Number((b - a).toFixed(1))
  }, [snapshot])

  useEffect(() => {
    prevSnapshotRef.current = snapshot
  }, [snapshot])

  const temperatureSetpoint = snapshot?.temperatureSetpoint ?? null
  const humiditySetpoint = snapshot?.humiditySetpoint ?? null

  const fanActive = snapshot?.convectionFanActive ?? false
  const lampActive = snapshot?.heatingLampActive ?? false
  const mistActive = snapshot?.mistGeneratorActive ?? false

  return (
    <RealTelemetryContext.Provider
      value={{
        humidityCurrent,
        humidityTrend,
        temperatureCurrent,
        temperatureTrend,
        co2Current,
        co2Trend,
        temperatureSetpoint,
        humiditySetpoint,
        snapshot,
        isLoading,
        fanActive,
        lampActive,
        mistActive,
        deviceStatus,
        lastTelemetryAt,
        monitoredDeviceId: DEFAULT_DEVICE_ID,
      }}
    >
      {children}
    </RealTelemetryContext.Provider>
  )
}

export function useRealTelemetry() {
  const ctx = useContext(RealTelemetryContext)
  if (ctx === undefined) {
    throw new Error('useRealTelemetry must be used within a RealTelemetryProvider')
  }
  return ctx
}
