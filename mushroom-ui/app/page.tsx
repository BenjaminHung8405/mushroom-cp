'use client'

import { DashboardLayout } from '@/components/dashboard-layout'
import { FuzzyLogicEqualizer } from '@/components/fuzzy-logic-equalizer'
import { SensorDataCard } from '@/components/sensor-data-card'
import { SimulationControlPanel } from '@/components/simulation-control-panel'
import { BatchStatusPanel } from '@/components/batch-status-panel'
import { StandardActuatorsControl } from '@/components/standard-actuators-control'
import { Card } from '@/components/ui/card'
import { BatchProvider, useBatch } from '@/lib/batch-context'
import { SimulationProvider } from '@/lib/simulation-context'
import { RealTelemetryProvider, useRealTelemetry } from '@/lib/real-telemetry-context'
import { useEffect, useState } from 'react'
import { Sliders } from 'lucide-react'
import {
  DEFAULT_DEVICE_ID,
  fetchTelemetryHistory,
  type TelemetrySnapshot,
} from '@/lib/telemetry-api'

function getStatus(
  current: number | null,
  min: number,
  max: number,
  critical?: [number, number],
): 'optimal' | 'warning' | 'critical' | 'empty' {
  if (current === null || current === undefined) return 'empty'
  if (critical && (current < critical[0] || current > critical[1])) return 'critical'
  if (current < min || current > max) return 'warning'
  return 'optimal'
}

function EnvironmentalHistoryChart() {
  const [points, setPoints] = useState<TelemetrySnapshot[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const to = new Date()
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000)
    fetchTelemetryHistory(DEFAULT_DEVICE_ID, from, to, '15 minutes').then((rows) => {
      if (!cancelled) {
        setPoints(rows)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const temps = points
    .map((p) => p.temperatureMeasured)
    .filter((v): v is number => v !== null && v !== undefined)
  const minT = temps.length ? Math.min(...temps) : 20
  const maxT = temps.length ? Math.max(...temps) : 40
  const span = Math.max(maxT - minT, 1)

  return (
    <Card className="p-6 border border-slate-700/50 bg-slate-950/40 h-full min-h-96 flex flex-col">
      <h3 className="font-semibold text-foreground mb-2">
        Đường cong môi trường (24h, bucket 15 phút)
      </h3>
      <p className="text-xs text-muted-foreground mb-4">
        TimescaleDB time_bucket — không render raw 5s points
      </p>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
          Đang tải history...
        </div>
      ) : points.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center rounded-lg bg-gradient-to-br from-slate-900/20 to-emerald-900/10 border border-dashed border-slate-700/30 py-12">
          <p className="text-sm text-muted-foreground mb-2">Chưa có dữ liệu lịch sử</p>
          <p className="text-xs text-slate-600">
            History xuất hiện sau khi ESP32 publish telemetry và backend ghi TimescaleDB
          </p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-2">
          <div className="relative h-48 border border-slate-800 rounded-lg bg-slate-950/60 overflow-hidden">
            <svg viewBox="0 0 100 40" className="w-full h-full" preserveAspectRatio="none">
              <polyline
                fill="none"
                stroke="#34d399"
                strokeWidth="0.6"
                points={points
                  .map((p, i) => {
                    const x = points.length === 1 ? 0 : (i / (points.length - 1)) * 100
                    const t = p.temperatureMeasured ?? minT
                    const y = 38 - ((t - minT) / span) * 34
                    return `${x},${y}`
                  })
                  .join(' ')}
              />
            </svg>
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-400">
            <div>
              Điểm: <span className="text-foreground font-semibold">{points.length}</span>
            </div>
            <div>
              T min/max:{' '}
              <span className="text-foreground font-semibold">
                {minT.toFixed(1)}/{maxT.toFixed(1)}°C
              </span>
            </div>
            <div>
              RH cuối:{' '}
              <span className="text-foreground font-semibold">
                {points[points.length - 1]?.humidityMeasured?.toFixed(1) ?? '—'}%
              </span>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function DashboardContent() {
  const {
    humidityCurrent,
    humidityTrend,
    temperatureCurrent,
    temperatureTrend,
    co2Current,
    co2Trend,
    humiditySetpoint,
    temperatureSetpoint,
    fanActive,
    heaterAirActive,
    heaterWaterActive,
    mistActive,
    middayBlackoutActive,
    snapshot,
    isLoading,
  } = useRealTelemetry()
  const { tempOptimalRange, humidityOptimalRange } = useBatch()
  const [sandboxOpen, setSandboxOpen] = useState(false)

  const humidityStatus = getStatus(
    humidityCurrent,
    humidityOptimalRange[0],
    humidityOptimalRange[1],
    [60, 95],
  )
  const temperatureStatus = getStatus(
    temperatureCurrent,
    tempOptimalRange[0],
    tempOptimalRange[1],
    [20, 40],
  )
  const co2Status = getStatus(co2Current, 800, 1200)

  return (
    <DashboardLayout>
      <style
        dangerouslySetInnerHTML={{
          __html: `
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
      `,
        }}
      />

      {isLoading && (
        <div className="col-span-1 md:col-span-2 lg:col-span-4 rounded-lg border border-slate-700/50 bg-slate-950/50 px-4 py-2 text-xs text-slate-400">
          Đang chờ snapshot telemetry thật từ backend…
        </div>
      )}

      <div className="col-span-1 md:col-span-1 lg:col-span-1">
        <SensorDataCard
          sensorType="humidity"
          currentValue={humidityCurrent}
          setpointValue={humiditySetpoint}
          unit="%"
          status={humidityStatus}
          trend={humidityTrend}
          actuatorActive={mistActive}
          lastUpdated={snapshot?.time ?? null}
        />
      </div>

      <div className="col-span-1 md:col-span-1 lg:col-span-1">
        <SensorDataCard
          sensorType="temperature"
          currentValue={temperatureCurrent}
          setpointValue={temperatureSetpoint}
          unit="°C"
          status={temperatureStatus}
          trend={temperatureTrend}
          actuatorActive={heaterAirActive}
          lastUpdated={snapshot?.time ?? null}
        />
      </div>

      <div className="col-span-1 md:col-span-1 lg:col-span-1">
        <SensorDataCard
          sensorType="co2"
          currentValue={co2Current}
          setpointValue={1000}
          unit="ppm"
          status={co2Status}
          trend={co2Trend}
          actuatorActive={fanActive}
          lastUpdated={snapshot?.time ?? null}
        />
      </div>

      <div className="col-span-1 md:col-span-1 lg:col-span-1">
        <BatchStatusPanel />
      </div>

      <div className="col-span-1 md:col-span-2 lg:col-span-2">
        <StandardActuatorsControl
          fanActive={fanActive}
          heaterAirActive={heaterAirActive}
          heaterWaterActive={heaterWaterActive}
          mistActive={mistActive}
          blackoutActive={middayBlackoutActive}
          readOnly
        />
      </div>

      <div className="col-span-1 md:col-span-2 lg:col-span-2 space-y-4">
        <EnvironmentalHistoryChart />
      </div>

      <div className="col-span-1 md:col-span-2 lg:col-span-4">
        <FuzzyLogicEqualizer />
      </div>

      {process.env.NODE_ENV === 'development' && (
        <>
          <div className="fixed bottom-6 right-6 z-50">
            <button
              onClick={() => setSandboxOpen(true)}
              className="relative flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white rounded-full shadow-lg hover:shadow-amber-500/20 hover:-translate-y-0.5 transition-all duration-300 cursor-pointer font-bold text-xs tracking-wider uppercase group border border-amber-400/25 select-none"
            >
              <Sliders className="w-4 h-4 group-hover:rotate-45 transition-transform duration-300 text-amber-100" />
              <span>Dev Sandbox</span>
            </button>
          </div>

          {sandboxOpen && (
            <div className="fixed inset-0 z-50 flex justify-end animate-fadeIn">
              <div
                className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs cursor-pointer"
                onClick={() => setSandboxOpen(false)}
              />
              <div className="relative w-80 max-w-[calc(100vw-3rem)] h-full bg-slate-950/95 border-l border-slate-800/80 text-foreground shadow-2xl p-6 flex flex-col justify-between overflow-y-auto animate-slideIn">
                <div>
                  <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-850">
                    <div className="flex items-center gap-2">
                      <Sliders className="w-5 h-5 text-amber-500" />
                      <div>
                        <h3 className="font-bold text-sm tracking-wider uppercase text-foreground">
                          Sandbox Kiểm Thử
                        </h3>
                        <p className="text-[10px] text-muted-foreground">
                          Dev-only — không che live telemetry
                        </p>
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
              </div>
            </div>
          )}
        </>
      )}
    </DashboardLayout>
  )
}

export default function Home() {
  return (
    <BatchProvider>
      <RealTelemetryProvider>
        <SimulationProvider>
          <DashboardContent />
        </SimulationProvider>
      </RealTelemetryProvider>
    </BatchProvider>
  )
}
