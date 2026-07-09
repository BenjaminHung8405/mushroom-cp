'use client'

import { DashboardLayout } from '@/components/dashboard-layout'
import { FuzzyLogicEqualizer } from '@/components/fuzzy-logic-equalizer'
import { MistGeneratorControl } from '@/components/mist-generator-control'
import { SensorDataCard } from '@/components/sensor-data-card'
import { SimulationControlPanel } from '@/components/simulation-control-panel'
import { StandardActuatorsControl } from '@/components/standard-actuators-control'
import { Card } from '@/components/ui/card'
import { SimulationProvider, useSimulation } from '@/lib/simulation-context'
import { useEffect, useState } from 'react'

const timeToMinutes = (timeStr: string): number => {
  if (!timeStr || !timeStr.includes(':')) return 0
  const [h, m] = timeStr.split(':').map(Number)
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)
}

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
    thermalShockStart,
    thermalShockEnd,
    thermalShockProtection,
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
  const startMin = timeToMinutes(thermalShockStart || "11:00")
  const endMin = timeToMinutes(thermalShockEnd || "13:30")

  // Robust check supporting both normal and cross-midnight ranges
  const isTimeInWindow = startMin <= endMin
    ? simulatedTimeMinutes >= startMin && simulatedTimeMinutes <= endMin
    : simulatedTimeMinutes >= startMin || simulatedTimeMinutes <= endMin

  const isBlackoutActive = thermalShockProtection && isTimeInWindow
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
      <h3 className="font-semibold text-foreground mb-4">Đường cong điều khiển môi trường</h3>
      <div className="flex-1 flex flex-col items-center justify-center rounded-lg bg-gradient-to-br from-slate-900/20 to-emerald-900/10 border border-dashed border-slate-700/30 py-12">
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-2">Biểu đồ đường tương tác</p>
          <p className="text-xs text-slate-600">Xu hướng môi trường theo thời gian thực sẽ hiển thị tại đây</p>
        </div>
      </div>
    </Card>
  )
}

function DashboardContent() {
  const { humidityData, temperatureData, co2Data, fanPWM, lampPWM, mistPWM } = useSensorData()
  const { tempOptimalRange, humidityOptimalRange } = useSimulation()

  const humidityStatus = getStatus(humidityData.current, humidityOptimalRange[0], humidityOptimalRange[1], [60, 95])
  const temperatureStatus = getStatus(temperatureData.current, tempOptimalRange[0], tempOptimalRange[1], [20, 40])
  const co2Status = getStatus(co2Data.current, 800, 1200)

  return (
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
  )
}

export default function Home() {
  return (
    <SimulationProvider>
      <DashboardContent />
    </SimulationProvider>
  )
}
