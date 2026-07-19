'use client'

import { DashboardLayout } from '@/components/dashboard-layout'
import { FuzzyLogicEqualizer } from '@/components/fuzzy-logic-equalizer'
import { SensorDataCard } from '@/components/sensor-data-card'
import { SimulationControlPanel } from '@/components/simulation-control-panel'
import { BatchStatusPanel } from '@/components/batch-status-panel'
import { StandardActuatorsControl } from '@/components/standard-actuators-control'
import { OfflineMonitoringDashboard } from '@/components/offline-monitoring-dashboard'
import { BatchProvider, useBatch } from '@/lib/batch-context'
import { SimulationProvider } from '@/lib/simulation-context'
import { SelectedDeviceProvider } from '@/lib/selected-device-context'
import { RealTelemetryProvider, useRealTelemetry } from '@/lib/real-telemetry-context'
import { useEffect, useState } from 'react'
import { Sliders } from 'lucide-react'

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
    lampStageActive,
    lampStage2Active,
    heaterWaterActive,
    mistActive,
    middayBlackoutActive,
    snapshot,
    isLoading,
    configSync,
  } = useRealTelemetry()
  const { tempOptimalRange, humidityOptimalRange } = useBatch()
const cfgSync = configSync
  const cfgColor =
    cfgSync?.status === 'APPLIED' ? 'border-emerald-500/40 text-emerald-400' :
    cfgSync?.status === 'ACKED' ? 'border-cyan-500/40 text-cyan-400' :
    cfgSync?.status === 'TIMEOUT' ? 'border-red-500/40 text-red-400' :
    cfgSync?.status === 'FAILED' ? 'border-orange-500/40 text-orange-400' :
    'border-slate-700/50 text-slate-500'

  const cfgLabel =
    cfgSync?.status === 'APPLIED' ? `Đã áp dụng (rev ${cfgSync.appliedRevision})` :
    cfgSync?.status === 'ACKED' ? `Thiết bị đã xác nhận (rev ${cfgSync.desiredRevision})` :
    cfgSync?.status === 'TIMEOUT' ? 'Thiết bị không phản hồi' :
    cfgSync?.status === 'FAILED' ? `Lỗi: ${cfgSync.error?.code ?? 'UNKNOWN'}` :
    cfgSync?.kind && (cfgSync.status === 'PENDING' || cfgSync.status === 'OUT_OF_SYNC') ? `${cfgSync.kind === 'baseline_setpoint' ? 'Setpoint' : 'Crop Profile'} chưa đồng bộ` :
    'Không có lệnh nào đang chờ'


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
          Đang kết nối để nhận dữ liệu từ phòng nấm…
        </div>
      )}

      <div className="col-span-1 md:col-span-1 lg:col-span-1">
        <div className={`rounded-lg border px-4 py-2 ${cfgColor}`} title={cfgSync?.error?.message ?? ''}>
          <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Đồng bộ</span>
          <p className="text-xs mt-0.5">{cfgLabel}</p>
        </div>
      </div>

      <div className="col-span-1 md:col-span-1 lg:col-span-1">
        <SensorDataCard
          sensorType="humidity"
          currentValue={humidityCurrent}
          setpointValue={humiditySetpoint}
          unit="%"
          status={humidityStatus}
          trend={humidityTrend}
          actuatorActive={mistActive ?? undefined}
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
          actuatorActive={lampStageActive ?? undefined}
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
          actuatorActive={fanActive ?? undefined}
          lastUpdated={snapshot?.time ?? null}
        />
      </div>

      <div className="col-span-1 md:col-span-1 lg:col-span-1">
        <BatchStatusPanel />
      </div>

      <div className="col-span-1 md:col-span-2 lg:col-span-2">
        <StandardActuatorsControl
          fanActive={fanActive}
          lampStageActive={lampStageActive}
          lampStage2Active={lampStage2Active}
          heaterWaterActive={heaterWaterActive}
          mistActive={mistActive}
          blackoutActive={middayBlackoutActive}
          readOnly
        />
      </div>

      <OfflineMonitoringDashboard />

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
              <span>Kiểm thử</span>
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
                          Khu vực kiểm thử
                        </h3>
                        <p className="text-[10px] text-muted-foreground">
                          Chỉ dùng để kiểm tra dữ liệu mô phỏng
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
    <SelectedDeviceProvider>
      <BatchProvider>
        <RealTelemetryProvider>
          <SimulationProvider>
            <DashboardContent />
          </SimulationProvider>
        </RealTelemetryProvider>
      </BatchProvider>
    </SelectedDeviceProvider>
  )
}
