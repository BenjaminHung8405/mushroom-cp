'use client'

import React, { createContext, useContext, useEffect, useMemo, useState, useRef } from 'react'
import { useBatch } from './batch-context'

/**
 * Device connection status derived from MQTT LWT events.
 *
 * 'online'  - ESP32-S3 is connected and actively reporting
 * 'offline' - EMQX fired the LWT because device lost connection
 * 'unknown' - Not yet received any status from backend (initial state)
 */
export type DeviceStatus = 'online' | 'offline' | 'unknown'

interface SimulationContextType {
  isSimulationActive: boolean
  setIsSimulationActive: (active: boolean) => void
  simulationSpeedMultiplier: number
  setSimulationSpeedMultiplier: (speed: number) => void
  currentSimulatedDay: number
  setCurrentSimulatedDay: (day: number) => void
  simulatedTimeMinutes: number
  setSimulatedTimeMinutes: (minutes: number) => void

  // Real-time Telemetry States
  humidityCurrent: number
  humidityTrend: number
  temperatureCurrent: number
  temperatureTrend: number
  co2Current: number
  co2Trend: number

  // Derived / Helper setpoints corresponding to simulation day
  temperatureSetpoint: number
  humiditySetpoint: number

  // --- Device Status (from NestJS SSE / MQTT LWT) ---
  /** Live connection status of the ESP32-S3 field device */
  deviceStatus: DeviceStatus
  /** ID of the device being monitored */
  monitoredDeviceId: string
  /** Force-trigger an offline event (Dev Sandbox testing only) */
  simulateDeviceOffline: () => void
  /** Restore online status (Dev Sandbox testing only) */
  simulateDeviceOnline: () => void
}

const SimulationContext = createContext<SimulationContextType | undefined>(undefined)

/**
 * Device ID to monitor for LWT status events.
 * Must match the MQTT username configured in EMQX and .env:
 *   MQTT_ESP32_USER=esp32_mushroom_s3_01
 */
const MONITORED_DEVICE_ID = process.env.NEXT_PUBLIC_DEVICE_ID ?? 'esp32_mushroom_s3_01'

/**
 * NestJS Backend API URL.
 * In Docker environment: http://mushroom-backend:3001
 * In local dev: http://localhost:3001
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const { totalCropDays, getTemperatureSetpoint, getHumiditySetpoint } = useBatch()

  // Centralized Simulation States
  const [isSimulationActive, setIsSimulationActive] = useState(false)
  const [simulationSpeedMultiplier, setSimulationSpeedMultiplier] = useState(1)
  const [currentSimulatedDay, setCurrentSimulatedDay] = useState(1)
  const [simulatedTimeMinutes, setSimulatedTimeMinutes] = useState(540) // 9:00 AM

  // Real-time Telemetry States
  const [humidityCurrent, setHumidityCurrent] = useState(78)
  const [humidityTrend, setHumidityTrend] = useState(2.3)
  const [temperatureCurrent, setTemperatureCurrent] = useState(31.2)
  const [temperatureTrend, setTemperatureTrend] = useState(-0.5)
  const [co2Current, setCo2Current] = useState(950)
  const [co2Trend, setCo2Trend] = useState(1.2)

  // --- Device Status State (LWT-driven) ---
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('unknown')
  const eventSourceRef = useRef<EventSource | null>(null)

  // Clamp current simulated day when totalCropDays boundary changes
  useEffect(() => {
    if (currentSimulatedDay > totalCropDays) {
      setCurrentSimulatedDay(totalCropDays)
      // Clamps simulated minutes within the 24h limit to prevent slider and telemetry overflows
      setSimulatedTimeMinutes((prev) => Math.min(prev, 1439))
    }
  }, [totalCropDays, currentSimulatedDay])

  // Background simulation time progression loop
  useEffect(() => {
    if (!isSimulationActive) return

    const interval = setInterval(() => {
      setSimulatedTimeMinutes((prev) => {
        // 1x = 10 mins/sec, 5x = 50 mins/sec, 10x = 100 mins/sec, 60x = 600 mins/sec (10 hours/sec)
        const increment = 10 * simulationSpeedMultiplier
        const nextTime = prev + increment
        
        if (nextTime >= 1440) {
          setCurrentSimulatedDay((day) => {
            const nextDay = day + 1
            if (nextDay > totalCropDays) {
              setIsSimulationActive(false) // pause at end of crop days
              return totalCropDays
            }
            return nextDay
          })
          return nextTime % 1440
        }
        return nextTime
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [isSimulationActive, simulationSpeedMultiplier, totalCropDays])

  // Derive setpoints from Batch Context based on the simulated day
  const temperatureSetpoint = useMemo(() => {
    return getTemperatureSetpoint(currentSimulatedDay)
  }, [currentSimulatedDay, getTemperatureSetpoint])

  const humiditySetpoint = useMemo(() => {
    return getHumiditySetpoint(currentSimulatedDay)
  }, [currentSimulatedDay, getHumiditySetpoint])

  // Simulated Telemetry drift and noise loop towards active setpoints
  useEffect(() => {
    const interval = setInterval(() => {
      setHumidityCurrent((prev) => {
        const drift = (humiditySetpoint - prev) * 0.1
        const randomFluc = (Math.random() - 0.5) * 1.5
        return Math.max(50, Math.min(100, prev + drift + randomFluc))
      })
      setHumidityTrend((Math.random() - 0.5) * 3)

      setTemperatureCurrent((prev) => {
        const drift = (temperatureSetpoint - prev) * 0.1
        const randomFluc = (Math.random() - 0.5) * 0.3
        return Math.max(20, Math.min(40, prev + drift + randomFluc))
      })
      setTemperatureTrend((Math.random() - 0.5) * 0.8)

      setCo2Current((prev) => {
        const randomFluc = (Math.random() - 0.5) * 20
        return Math.max(400, Math.min(3000, prev + randomFluc))
      })
      setCo2Trend((Math.random() - 0.5) * 1.5)
    }, 3000)

    return () => clearInterval(interval)
  }, [temperatureSetpoint, humiditySetpoint])

  /**
   * SSE Connection: Connect to NestJS /devices/status/stream
   *
   * The browser natively handles reconnection on network drops — no
   * manual reconnect logic needed (SSE advantage over WebSockets).
   *
   * On each 'device-status' event, we filter for the monitored device
   * and update the deviceStatus state, which triggers UI re-render.
   */
  useEffect(() => {
    const sseUrl = `${API_URL}/devices/status/stream`

    // Only connect in browser environment (not during SSR)
    if (typeof window === 'undefined') return

    const connectSSE = () => {
      const es = new EventSource(sseUrl)
      eventSourceRef.current = es

      es.addEventListener('device-status', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data as string) as {
            deviceId: string
            status: 'online' | 'offline'
          }

          if (data.deviceId === MONITORED_DEVICE_ID) {
            setDeviceStatus(data.status)
          }
        } catch {
          console.warn('[SSE] Failed to parse device-status event:', event.data)
        }
      })

      es.onerror = () => {
        // Browser auto-reconnects. We just note it in dev console.
        // setDeviceStatus('unknown') could be set here but could cause
        // flicker on brief network hiccups. Keep last known state instead.
        console.warn('[SSE] Connection error. Browser will auto-reconnect...')
      }
    }

    connectSSE()

    return () => {
      eventSourceRef.current?.close()
      eventSourceRef.current = null
    }
  }, []) // Connect once on mount

  // --- Dev Sandbox: Simulate LWT events for UI testing ---
  const simulateDeviceOffline = () => setDeviceStatus('offline')
  const simulateDeviceOnline  = () => setDeviceStatus('online')

  return (
    <SimulationContext.Provider
      value={{
        isSimulationActive,
        setIsSimulationActive,
        simulationSpeedMultiplier,
        setSimulationSpeedMultiplier,
        currentSimulatedDay,
        setCurrentSimulatedDay,
        simulatedTimeMinutes,
        setSimulatedTimeMinutes,
        humidityCurrent,
        humidityTrend,
        temperatureCurrent,
        temperatureTrend,
        co2Current,
        co2Trend,
        temperatureSetpoint,
        humiditySetpoint,
        deviceStatus,
        monitoredDeviceId: MONITORED_DEVICE_ID,
        simulateDeviceOffline,
        simulateDeviceOnline,
      }}
    >
      {children}
    </SimulationContext.Provider>
  )
}

export function useSimulation() {
  const context = useContext(SimulationContext)
  if (context === undefined) {
    throw new Error('useSimulation must be used within a SimulationProvider')
  }
  return context
}
