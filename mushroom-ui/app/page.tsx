'use client'

import { DashboardLayout } from '@/components/dashboard-layout'
import { FuzzyLogicEqualizer } from '@/components/fuzzy-logic-equalizer'
import { SensorDataCard } from '@/components/sensor-data-card'
import { SimulationControlPanel } from '@/components/simulation-control-panel'
import { BatchStatusPanel } from '@/components/batch-status-panel'
import { StandardActuatorsControl } from '@/components/standard-actuators-control'
import { Card } from '@/components/ui/card'
import { BatchProvider, useBatch } from '@/lib/batch-context'
import { SimulationProvider, useSimulation } from '@/lib/simulation-context'
import { useEffect, useState } from 'react'
import { Sliders } from 'lucide-react'

const timeToMinutes = (timeStr: string): number => {
  if (!timeStr || !timeStr.includes(':')) return 0
  const [h, m] = timeStr.split(':').map(Number)
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m)
}

// Mock sensor data simulator that reacts to simulation setpoints
function useSensorData() {
  const { spawnRunningEndDay, thermalShockProtection, thermalShockStart, thermalShockEnd } = useBatch()
  const {
    humidityCurrent,
    humidityTrend,
    humiditySetpoint,
    temperatureCurrent,
    temperatureTrend,
    temperatureSetpoint,
    co2Current,
    co2Trend,
    currentSimulatedDay,
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
  const startMin = timeToMinutes(thermalShockStart || "11:00")
  const endMin = timeToMinutes(thermalShockEnd || "13:30")

  // Robust check supporting both normal and cross-midnight ranges
  const isTimeInWindow = startMin <= endMin
    ? simulatedTimeMinutes >= startMin && simulatedTimeMinutes <= endMin
    : simulatedTimeMinutes >= startMin || simulatedTimeMinutes <= endMin

  const isBlackoutActive = thermalShockProtection && isTimeInWindow
  const isLampsLocked = currentSimulatedDay > spawnRunningEndDay

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
  const { tempOptimalRange, humidityOptimalRange } = useBatch()
  const [sandboxOpen, setSandboxOpen] = useState(false)

  const humidityStatus = getStatus(humidityData.current, humidityOptimalRange[0], humidityOptimalRange[1], [60, 95])
  const temperatureStatus = getStatus(temperatureData.current, tempOptimalRange[0], tempOptimalRange[1], [20, 40])
  const co2Status = getStatus(co2Data.current, 800, 1200)

  return (
    <DashboardLayout>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out forwards;
        }
        .animate-slideIn {
          animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      ` }} />

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

      {/* 4th Grid Column: Premium BatchStatusPanel */}
      <div className="col-span-1 md:col-span-1 lg:col-span-1">
        <BatchStatusPanel />
      </div>

      {/* Row 2: Actuator Controls & Simulation - Stack on mobile */}
      <div className="col-span-1 md:col-span-2 lg:col-span-2">
        <StandardActuatorsControl fanPWM={fanPWM} lampPWM={lampPWM} />
      </div>

      <div className="col-span-1 md:col-span-2 lg:col-span-2 space-y-4">
        <EnvironmentalControlChartPlaceholder />
      </div>

      {/* Row 3: Fuzzy Logic Equalizer (Full Width) */}
      <div className="col-span-1 md:col-span-2 lg:col-span-4">
        <FuzzyLogicEqualizer />
      </div>

      {/* Developer Test Sandbox FAB Trigger */}
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => setSandboxOpen(true)}
          className="relative flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white rounded-full shadow-lg hover:shadow-amber-500/20 hover:-translate-y-0.5 transition-all duration-300 cursor-pointer font-bold text-xs tracking-wider uppercase group border border-amber-400/25 select-none"
        >
          <Sliders className="w-4 h-4 group-hover:rotate-45 transition-transform duration-300 text-amber-100" />
          <span>Dev Sandbox</span>
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
          </span>
        </button>
      </div>

      {/* Sandbox Drawer Panel */}
      {sandboxOpen && (
        <div className="fixed inset-0 z-50 flex justify-end animate-fadeIn">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs cursor-pointer"
            onClick={() => setSandboxOpen(false)}
          />
          {/* Drawer Container */}
          <div className="relative w-80 max-w-[calc(100vw-3rem)] h-full bg-slate-950/95 border-l border-slate-800/80 text-foreground shadow-2xl p-6 flex flex-col justify-between overflow-y-auto animate-slideIn">
            <div>
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-850">
                <div className="flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-amber-500" />
                  <div>
                    <h3 className="font-bold text-sm tracking-wider uppercase text-foreground">Sandbox Kiểm Thử</h3>
                    <p className="text-[10px] text-muted-foreground">Môi trường giả lập IoT</p>
                  </div>
                </div>
                <button
                  onClick={() => setSandboxOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer text-lg font-bold"
                >
                  &times;
                </button>
              </div>
              
              <SimulationControlPanel />
            </div>
            
            <div className="mt-8 pt-4 border-t border-slate-850 text-center">
              <p className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold">
                MUSHROOM CP SANDBOX V1.0
              </p>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}

export default function Home() {
  return (
    <BatchProvider>
      <SimulationProvider>
        <DashboardContent />
      </SimulationProvider>
    </BatchProvider>
  )
}
