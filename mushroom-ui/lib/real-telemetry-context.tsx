'use client'

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
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
 * RealTelemetryProvider — replaces SimulationProvider with live data.
 *
 * Reads from NestJS backend endpoints:
 *   - GET /devices/:id/telemetry          (initial snapshot)
 *   - SSE /devices/:id/telemetry/stream   (live updates)
 *   - SSE /devices/status/stream          (LWT online/offline)
 *
 * Exposes the same shape as SimulationContext so dashboard components
 * work without modification.
 */

interface RealTelemetryContextType {
  // ── Telemetry (from real snapshot) ────────────────────────────────
  humidityCurrent: number | null
  humidityTrend: number | null
  temperatureCurrent: number | null
  temperatureTrend: number | null
  co2Current: number | null
  co2Trend: number | null

  // ── Setpoints reported by backend batch context ───────────────────
  temperatureSetpoint: number | null
  humiditySetpoint: number | null
  snapshot: TelemetrySnapshot | null
  isLoading: boolean

  // ── Actuator booleans (read-only from real snapshot) ──────────────
  fanActive: boolean
  lampActive: boolean
  mistActive: boolean

  // ── Device status (from LWT SSE) ──────────────────────────────────
  deviceStatus: DeviceStatus
  monitoredDeviceId: string
}

const RealTelemetryContext = createContext<RealTelemetryContextType | undefined>(undefined)

export function RealTelemetryProvider({ children }: { children: React.ReactNode }) {
  // ── Telemetry state ───────────────────────────────────────────────
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null)
  const prevSnapshotRef = useRef<TelemetrySnapshot | null>(null)

  // ── Device status ─────────────────────────────────────────────────
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('unknown')

  // ── Initial snapshot fetch ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    fetchTelemetrySnapshot(DEFAULT_DEVICE_ID).then((snap) => {
      if (!cancelled && snap) setSnapshot(snap)
    })
    return () => { cancelled = true }
  }, [])

  // ── Live SSE stream ───────────────────────────────────────────────
  useEffect(() => {
    return subscribeTelemetryStream(DEFAULT_DEVICE_ID, (snap) => {
      setSnapshot(snap)
    })
  }, [])

  // ── Device status SSE ─────────────────────────────────────────────
  useEffect(() => {
    return subscribeDeviceStatusStream((ev: DeviceStatusEvent) => {
      if (ev.deviceId === DEFAULT_DEVICE_ID) {
        setDeviceStatus(ev.status)
      }
    })
  }, [])

  // ── Derived telemetry values ──────────────────────────────────────
  const humidityCurrent = snapshot?.humidityMeasured ?? null
  const temperatureCurrent = snapshot?.temperatureMeasured ?? null
  const co2Current = snapshot?.co2Measured ?? null
  const isLoading = snapshot === null && deviceStatus === 'unknown'

  // Compute trend as delta from previous snapshot
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

  // Update previous snapshot ref after computing trends
  useEffect(() => {
    prevSnapshotRef.current = snapshot
  }, [snapshot])

  // ── Setpoints reported by backend batch context ───────────────────
  const temperatureSetpoint = snapshot?.temperatureSetpoint ?? null
  const humiditySetpoint = snapshot?.humiditySetpoint ?? null

  // ── Actuator booleans (read-only) ─────────────────────────────────
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