'use client'

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from 'react'
import type { DeviceStatus } from './simulation-context'
import { fetchConfigSync, subscribeConfigSyncStream } from './telemetry-api'

import {
  fetchTelemetrySnapshot,
  subscribeTelemetryStream,
  subscribeDeviceStatusStream,
  type TelemetrySnapshot,
  type DeviceStatusEvent,
} from './telemetry-api'
import { useSelectedDevice } from './selected-device-context'

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
const SNAPSHOT_REFRESH_MS = 5_000

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
  /** Configuration synchronisation status — null means no pending command or unknown */
  configSync: import('./types').ConfigSyncEvent | null


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

  fanActive: boolean | null
  /** Stage 1 thermal-lamp active state (replaces legacy heaterAirActive) */
  lampStageActive: boolean | null
  lampStage2Active: boolean | null
  heaterWaterActive: boolean | null
  mistActive: boolean | null
  middayBlackoutActive: boolean | null

  /** Global operating mode from firmware telemetry (AI | MANUAL) */
  operatingMode: 'AI' | 'MANUAL' | null

  /** Firmware-authoritative manual ack states — null means no ack received yet */
  mistAck: import('./telemetry-api').ManualAckState | null
  fanAck: import('./telemetry-api').ManualAckState | null
  lampAck: import('./telemetry-api').ManualAckState | null

  deviceStatus: DeviceStatus
  lastTelemetryAt: string | null
  monitoredDeviceId: string | null
}

const RealTelemetryContext = createContext<RealTelemetryContextType | undefined>(
  undefined,
)

export function RealTelemetryProvider({ children }: { children: React.ReactNode }) {
  const { selectedDeviceId } = useSelectedDevice()
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const prevSnapshotRef = useRef<TelemetrySnapshot | null>(null)

  // An initial HTTP response can arrive after a newer SSE event. Never let an
  // older snapshot overwrite the latest physical relay state in the dashboard.
  const applySnapshot = useCallback((next: TelemetrySnapshot) => {
    setSnapshot((current) => {
      if (!current) return next
      const currentMs = new Date(current.time).getTime()
      const nextMs = new Date(next.time).getTime()
      return Number.isFinite(currentMs) && Number.isFinite(nextMs) && nextMs < currentMs
        ? current
        : next
    })
  }, [])

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

  // Reset device-scoped state whenever the dashboard selection changes.
  useEffect(() => {
    setSnapshot(null)
    prevSnapshotRef.current = null
    setLwtStatus('unknown')
    setOnlineSinceMs(null)
  }, [selectedDeviceId])

  // Initial snapshot and live telemetry are tied to the selected device.
  useEffect(() => {
    if (!selectedDeviceId) return

    let cancelled = false
    fetchTelemetrySnapshot(selectedDeviceId).then((snap) => {
      if (!cancelled && snap) applySnapshot(snap)
    })
    const unsubscribe = subscribeTelemetryStream(selectedDeviceId, applySnapshot)

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [selectedDeviceId, applySnapshot])

  // SSE is the primary real-time transport. Polling is a deliberately small
  // fallback for deployments where an ingress/proxy drops or buffers SSE; it
  // also recovers state after a transient EventSource reconnect.
  useEffect(() => {
    if (!selectedDeviceId) return

    const refresh = () => {
      fetchTelemetrySnapshot(selectedDeviceId).then((snap) => {
        if (snap) applySnapshot(snap)
      })
    }
    const timer = setInterval(refresh, SNAPSHOT_REFRESH_MS)
    return () => clearInterval(timer)
  }, [selectedDeviceId, applySnapshot])

  // LWT status SSE — writes only to lwtStatus; also records when online began.
  useEffect(() => {
    if (!selectedDeviceId) return

    return subscribeDeviceStatusStream((ev: DeviceStatusEvent) => {
      if (ev.deviceId === selectedDeviceId) {
        setLwtStatus(ev.status)
        if (ev.status === 'online') {
          const timestamp = new Date(ev.timestamp).getTime()
          setOnlineSinceMs(Number.isFinite(timestamp) ? timestamp : Date.now())
        } else {
          setOnlineSinceMs(null)
        }
      }
    })
  }, [selectedDeviceId])

  // ── Config-sync live stream ─────────────────────────────────────────
  const [configSync, setConfigSync] = useState<import('./types').ConfigSyncEvent | null>(null)

  useEffect(() => {
    if (!selectedDeviceId) return setConfigSync(null)
    let cancelled = false
    fetchConfigSync(selectedDeviceId).then((snap) => {
      if (!cancelled && snap) setConfigSync(snap)
    })
    const unsub = subscribeConfigSyncStream(selectedDeviceId, (ev) => {
      if (!cancelled) setConfigSync(ev)
    })
    return () => { cancelled = true; unsub() }
  }, [selectedDeviceId])

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

  // Relay states are valid only while the reporting telemetry is fresh. Never
  // keep rendering a last-known ON state after the ESP32 stops reporting.
  const hasFreshTelemetry =
    lwtStatus !== 'offline' &&
    lastTelemetryMs !== null && nowMs - lastTelemetryMs <= STALE_MS
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

  const fanActive = hasFreshTelemetry ? snapshot?.convectionFanActive ?? null : null
  const lampStageActive = hasFreshTelemetry ? snapshot?.lampStageActive ?? null : null
  const lampStage2Active = hasFreshTelemetry ? snapshot?.lampStage2Active ?? null : null
  const heaterWaterActive = hasFreshTelemetry ? snapshot?.heaterWaterActive ?? null : null
  const mistActive = hasFreshTelemetry ? snapshot?.mistGeneratorActive ?? null : null
  const middayBlackoutActive = hasFreshTelemetry
    ? snapshot?.middayBlackoutActive ?? null
    : null

  const mistAck = snapshot?.mistAck ?? null
  const fanAck = snapshot?.fanAck ?? null
  const lampAck = snapshot?.lampAck ?? null
  const operatingMode: 'AI' | 'MANUAL' | null = hasFreshTelemetry
    ? snapshot?.operatingMode ?? null
    : null

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
        lampStageActive,
        lampStage2Active,
        heaterWaterActive,
        mistActive,
        middayBlackoutActive,
        operatingMode,
        mistAck,
        fanAck,
        lampAck,
        configSync,
        deviceStatus,
        lastTelemetryAt,
        monitoredDeviceId: selectedDeviceId,
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
