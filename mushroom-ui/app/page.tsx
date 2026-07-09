'use client'

import { useState, useEffect } from 'react'
import { DashboardLayout } from '@/components/dashboard-layout'
import { SensorDataCard } from '@/components/sensor-data-card'
import { MistGeneratorControl } from '@/components/mist-generator-control'
import { StandardActuatorsControl } from '@/components/standard-actuators-control'
import { FuzzyLogicEqualizer } from '@/components/fuzzy-logic-equalizer'
import { SimulationControlPanel } from '@/components/simulation-control-panel'
import { Card } from '@/components/ui/card'
import { SimulationProvider, useSimulation } from '@/lib/simulation-context'

// Mock sensor data simulator that reacts to simulation setpoints
function useSensorData() {
  const {
    humidityCurrent,
    humidityTrend,
    humiditySetpoint,
    temperatureCurrent,
    temperatureTrend,
    temperatureSetpoint,
    co2Current,
    co2Trend,
    currentCropDay,
    simulatedTimeMinutes,
  } = useSimulation()

  const [fanPWM, setFanPWM] = useState(35)
  const [lampPWM, setLampPWM] = useState(0)
  const [mistPWM, setMistPWM] = useState(45)

  // Simulate actuator adjustments (local simulation for PWM signals)
  useEffect(() => {
    const interval = setInterval(() => {
      setFanPWM((prev) => Math.max(0, Math.min(100, prev + (Math.random() - 0.5) * 6)))
      setLampPWM((prev) => Math.max(0, Math.min(100, prev + (Math.random() - 0.5) * 4)))
      setMistPWM((prev) => Math.max(0, Math.min(100, prev + (Math.random() - 0.5) * 5)))
    }, 3000)

    return () => clearInterval(interval)
  }, [])

  // Apply biological locks on PWM visualizers
  const isBlackoutActive = simulatedTimeMinutes >= 660 && simulatedTimeMinutes <= 810
  const isLampsLocked = currentCropDay >= 9

  const finalLampPWM = isLampsLocked ? 0 : lampPWM
  const finalMistPWM = isBlackoutActive ? 0 : mistPWM

  return {
    humidityData: {
      current: humidityCurrent,
      setpoint: humiditySetpoint,
      trend: humidityTrend,
      pwm: finalMistPWM,
    },
    temperatureData: {
      current: temperatureCurrent,
      setpoint: temperatureSetpoint,
      trend: temperatureTrend,
      pwm: finalLampPWM,
    },
    co2Data: {
      current: co2Current,
      setpoint: 1000,
      trend: co2Trend,
      pwm: 38,
    },
    fanPWM,
    lampPWM: finalLampPWM,
    mistPWM: finalMistPWM,
  }
}

function getStatus(
  current: number,
  min: number,
  max: number,
  critical?: [number, number]
): 'optimal' | 'warning' | 'critical' {
  if (critical && (current < critical[0] || current > critical[1])) {
    return 'critical'
  }
  if (current < min || current > max) {
    return 'warning'
  }
  return 'optimal'
}

function EnvironmentalControlChartPlaceholder() {
  return (
    <Card className="p-6 border border-slate-700/50 bg-slate-950/40 h-full min-h-96 flex flex-col justify-between">
      <h3 className="font-semibold text-foreground mb-4">Environmental Control Curve</h3>
      <div className="flex-1 flex flex-col items-center justify-center rounded-lg bg-gradient-to-br from-slate-900/20 to-emerald-900/10 border border-dashed border-slate-700/30 py-12">
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">Interactive Line Chart</p>
          <p className="text-xs text-slate-600">Real-time environmental trends will render here</p>
        </div>
      </div>
    </Card>
  )
}

function HardwareTelemetryBar() {
  const { powerSource } = useSimulation()

  return (
    <div className="sticky top-0 z-50 w-full bg-slate-900/90 border-b border-slate-700/50 backdrop-blur-sm py-2 px-4 md:py-3 md:px-6">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-2 md:gap-4 text-xs md:text-sm">
        {/* Power Status */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full animate-pulse ${powerSource === 'GRID_POWER' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            <span className={`font-medium ${powerSource === 'GRID_POWER' ? 'text-emerald-300' : 'text-amber-300'}`}>
              {powerSource === 'GRID_POWER' ? 'Grid Power' : 'UPS Battery Active'}
            </span>
          </div>
          <span className="text-muted-foreground hidden sm:inline">•</span>
        </div>
        
        {/* SD Logging */}
        <div className="flex items-center gap-1.5 hidden sm:flex">
          <span className="text-emerald-400">✓</span>
          <span className="text-muted-foreground">SD Logging: Active (5m intervals)</span>
          <span className="text-muted-foreground">•</span>
        </div>
        
        {/* Cloud Sync */}
        <div className="flex items-center gap-1.5 hidden md:flex">
          <span className="text-emerald-400">✓</span>
          <span className="text-muted-foreground">Cloud Sync: OK</span>
          <span className="text-muted-foreground">•</span>
        </div>
        
        {/* System Uptime */}
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">⏱</span>
          <span className="text-muted-foreground">Uptime: 7d 12h 34m</span>
        </div>
      </div>
    </div>
  )
}

function DashboardContent() {
  const { humidityData, temperatureData, co2Data, fanPWM, lampPWM, mistPWM } = useSensorData()

  const humidityStatus = getStatus(humidityData.current, 70, 90, [60, 95])
  const temperatureStatus = getStatus(temperatureData.current, 28, 35, [20, 40])
  const co2Status = getStatus(co2Data.current, 800, 1200)

  return (
    <>
      <HardwareTelemetryBar />
      <DashboardLayout>
        {/* Row 1: Sensor Telemetry Cards - Full width on mobile */}
        <div className="col-span-1 md:col-span-1 lg:col-span-1">
          <SensorDataCard
            sensorType="humidity"
            currentValue={humidityData.current}
            setpointValue={humidityData.setpoint}
            unit="%"
            status={humidityStatus}
            trend={humidityData.trend}
            pwmDutyCycle={humidityData.pwm}
          />
        </div>

        <div className="col-span-1 md:col-span-1 lg:col-span-1">
          <SensorDataCard
            sensorType="temperature"
            currentValue={temperatureData.current}
            setpointValue={temperatureData.setpoint}
            unit="°C"
            status={temperatureStatus}
            trend={temperatureData.trend}
            pwmDutyCycle={temperatureData.pwm}
          />
        </div>

        <div className="col-span-1 md:col-span-1 lg:col-span-1">
          <SensorDataCard
            sensorType="co2"
            currentValue={co2Data.current}
            setpointValue={co2Data.setpoint}
            unit="ppm"
            status={co2Status}
            trend={co2Data.trend}
          />
        </div>

        {/* Row 2: Actuator Controls + Simulation Panel - Stack on mobile */}
        <div className="col-span-1 md:col-span-2 lg:col-span-2 space-y-4">
          <MistGeneratorControl pwmDutyCycle={mistPWM} />
          <StandardActuatorsControl fanPWM={fanPWM} lampPWM={lampPWM} />
        </div>

        <div className="col-span-1 md:col-span-2 lg:col-span-2 space-y-4">
          <SimulationControlPanel />
          <EnvironmentalControlChartPlaceholder />
        </div>

        {/* Row 3: Fuzzy Logic Equalizer (Full Width) */}
        <div className="col-span-1 md:col-span-2 lg:col-span-4">
          <FuzzyLogicEqualizer />
        </div>
      </DashboardLayout>
    </>
  )
}

export default function Home() {
  return (
    <SimulationProvider>
      <DashboardContent />
    </SimulationProvider>
  )
}
