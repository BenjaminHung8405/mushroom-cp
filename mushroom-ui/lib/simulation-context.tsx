'use client'

import React, { createContext, useContext, useState, useMemo, useEffect } from 'react'

export type PowerSource = 'GRID_POWER' | 'UPS_BATTERY'

export interface Checkpoint {
  day: number
  value: number
}

export interface DayTrack {
  day: number
  active: boolean
}

export interface LightTimelineBlock {
  id: string
  startDay: number
  endDay: number
  status: 'ON' | 'OFF'
}

interface SimulationContextType {
  // Centralized Simulation States
  currentCropDay: number
  setCurrentCropDay: (day: number) => void
  simulatedTimeMinutes: number
  setSimulatedTimeMinutes: (minutes: number) => void
  powerSource: PowerSource
  setPowerSource: (source: PowerSource) => void

  // Active Profile States (Shared between Equalizer and Telemetry Cards)
  profileName: string
  setProfileName: (name: string) => void
  thermalShockProtection: boolean
  setThermalShockProtection: (active: boolean) => void
  
  temperatureCheckpoints: Checkpoint[]
  setTemperatureCheckpoints: (checkpoints: Checkpoint[]) => void
  
  humidityCheckpoints: Checkpoint[]
  setHumidityCheckpoints: (checkpoints: Checkpoint[]) => void
  
  lightDayStates: DayTrack[]
  setLightDayStates: (states: DayTrack[]) => void
  
  // Real-time Telemetry States
  humidityCurrent: number
  humidityTrend: number
  temperatureCurrent: number
  temperatureTrend: number
  co2Current: number
  co2Trend: number

  // Derived / Helper getters
  temperatureSetpoint: number
  humiditySetpoint: number
  isLightActiveToday: boolean
}

const SimulationContext = createContext<SimulationContextType | undefined>(undefined)

// Helper: Linear interpolation between curve checkpoints
function interpolateValue(day: number, checkpoints: Checkpoint[]): number {
  if (checkpoints.length === 0) return 0
  const sorted = [...checkpoints].sort((a, b) => a.day - b.day)
  
  if (day <= sorted[0].day) return sorted[0].value
  if (day >= sorted[sorted.length - 1].day) return sorted[sorted.length - 1].value
  
  for (let i = 0; i < sorted.length - 1; i++) {
    const p1 = sorted[i]
    const p2 = sorted[i + 1]
    if (day >= p1.day && day <= p2.day) {
      const ratio = (day - p1.day) / (p2.day - p1.day)
      return p1.value + ratio * (p2.value - p1.value)
    }
  }
  return sorted[0].value
}

export function SimulationProvider({ children }: { children: React.ReactNode }) {
  const [currentCropDay, setCurrentCropDay] = useState(1)
  const [simulatedTimeMinutes, setSimulatedTimeMinutes] = useState(540) // 9:00 AM
  const [powerSource, setPowerSource] = useState<PowerSource>('GRID_POWER')

  const [profileName, setProfileName] = useState('Dry Season Optimization')
  const [thermalShockProtection, setThermalShockProtection] = useState(true)
  
  const [temperatureCheckpoints, setTemperatureCheckpoints] = useState<Checkpoint[]>([
    { day: 1, value: 30 },
    { day: 7, value: 32 },
    { day: 14, value: 31 },
    { day: 21, value: 28 },
  ])
  
  const [humidityCheckpoints, setHumidityCheckpoints] = useState<Checkpoint[]>([
    { day: 1, value: 75 },
    { day: 7, value: 85 },
    { day: 15, value: 80 },
    { day: 21, value: 70 },
  ])
  
  const [lightDayStates, setLightDayStates] = useState<DayTrack[]>(
    Array.from({ length: 21 }, (_, i) => ({
      day: i + 1,
      active: i < 8, // Days 1-8 are ON
    }))
  )

  // Compute setpoints dynamically based on the current Crop Day
  const temperatureSetpoint = useMemo(() => {
    return interpolateValue(currentCropDay, temperatureCheckpoints)
  }, [currentCropDay, temperatureCheckpoints])

  const humiditySetpoint = useMemo(() => {
    return interpolateValue(currentCropDay, humidityCheckpoints)
  }, [currentCropDay, humidityCheckpoints])

  const isLightActiveToday = useMemo(() => {
    const todayState = lightDayStates.find((state) => state.day === currentCropDay)
    return todayState ? todayState.active : false
  }, [currentCropDay, lightDayStates])

  // Real-time Telemetry States
  const [humidityCurrent, setHumidityCurrent] = useState(78)
  const [humidityTrend, setHumidityTrend] = useState(2.3)
  const [temperatureCurrent, setTemperatureCurrent] = useState(31.2)
  const [temperatureTrend, setTemperatureTrend] = useState(-0.5)
  const [co2Current, setCo2Current] = useState(950)
  const [co2Trend, setCo2Trend] = useState(1.2)

  // Telemetry loop
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

  return (
    <SimulationContext.Provider
      value={{
        currentCropDay,
        setCurrentCropDay,
        simulatedTimeMinutes,
        setSimulatedTimeMinutes,
        powerSource,
        setPowerSource,
        profileName,
        setProfileName,
        thermalShockProtection,
        setThermalShockProtection,
        temperatureCheckpoints,
        setTemperatureCheckpoints,
        humidityCheckpoints,
        setHumidityCheckpoints,
        lightDayStates,
        setLightDayStates,
        humidityCurrent,
        humidityTrend,
        temperatureCurrent,
        temperatureTrend,
        co2Current,
        co2Trend,
        temperatureSetpoint,
        humiditySetpoint,
        isLightActiveToday,
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
