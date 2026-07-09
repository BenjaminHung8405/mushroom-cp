'use client'

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useBatch } from './batch-context'

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
}

const SimulationContext = createContext<SimulationContextType | undefined>(undefined)

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
