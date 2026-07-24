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
 * Health is authoritative from backend SSE; provider never runs a clock ticker.
 */

const SNAPSHOT_REFRESH_MS = 8_000

type LwtStatus = 'online' | 'offline' | 'unknown'

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
  /** Immediately refetch the selected device's authoritative telemetry snapshot. */
  refreshTelemetry: () => Promise<void>
}

const RealTelemetryContext = createContext<RealTelemetryContextType | undefined>(
  undefined,
)

export function RealTelemetryProvider({ children }: { children: React.ReactNode }) {
  const { selectedDeviceId } = useSelectedDevice()
  const selectedDeviceIdRef = useRef(selectedDeviceId)
  selectedDeviceIdRef.current = selectedDeviceId
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
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('UNKNOWN')

  const refreshTelemetry = useCallback(async () => {
    const requestedDeviceId = selectedDeviceId
    if (!requestedDeviceId) return
    const nextSnapshot = await fetchTelemetrySnapshot(requestedDeviceId)
    // Do not let a slow refresh for the previously selected device overwrite
    // the state that belongs to the device currently visible in the UI.
    if (nextSnapshot && selectedDeviceIdRef.current === requestedDeviceId) {
      applySnapshot(nextSnapshot)
    }
  }, [selectedDeviceId, applySnapshot])


  // Reset device-scoped state whenever the dashboard selection changes.
  useEffect(() => {
    setSnapshot(null)
    prevSnapshotRef.current = null
    setLwtStatus('unknown')
    setDeviceStatus('UNKNOWN')
  }, [selectedDeviceId])

  // Initial snapshot and live telemetry are tied to the selected device.
  useEffect(() => {
    if (!selectedDeviceId) return

    void refreshTelemetry()
    const unsubscribe = subscribeTelemetryStream(selectedDeviceId, applySnapshot)

    return () => {
      unsubscribe()
    }
  }, [selectedDeviceId, refreshTelemetry, applySnapshot])

  // SSE is the primary real-time transport. Polling is a deliberately small
  // fallback for deployments where an ingress/proxy drops or buffers SSE; it
  // also recovers state after a transient EventSource reconnect.
  useEffect(() => {
    if (!selectedDeviceId) return

    const timer = setInterval(() => void refreshTelemetry(), SNAPSHOT_REFRESH_MS)
    return () => clearInterval(timer)
  }, [selectedDeviceId, refreshTelemetry])

  // LWT status SSE — writes only to lwtStatus; also records when online began.
  useEffect(() => {
    if (!selectedDeviceId) return

    return subscribeDeviceStatusStream((ev: DeviceStatusEvent) => {
      if (ev.deviceId === selectedDeviceId) {
        setLwtStatus(ev.status)
        setDeviceStatus(ev.health)

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

  // Relay states are valid only while the reporting telemetry is fresh. Never
  // keep rendering a last-known ON state after the ESP32 stops reporting.
  const hasFreshTelemetry =
    deviceStatus === 'ONLINE_ACTIVE' || deviceStatus === 'DEGRADED_LATENCY'
  const humidityCurrent = hasFreshTelemetry ? (snapshot?.humidityMeasured ?? null) : null
  const temperatureCurrent = hasFreshTelemetry ? (snapshot?.temperatureMeasured ?? null) : null
  const co2Current = hasFreshTelemetry ? (snapshot?.co2Measured ?? null) : null
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
        refreshTelemetry,
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
