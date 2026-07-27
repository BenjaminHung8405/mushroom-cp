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
import { SelectedDeviceProvider, useSelectedDevice } from '@/lib/selected-device-context'
import { RealTelemetryProvider, useRealTelemetry } from '@/lib/real-telemetry-context'
import { TuningAdvisoryPanel } from '@/app/components/tuning/TuningAdvisoryPanel'
import { useState } from 'react'
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

function TelemetrySyncBadge({
  configSync,
}: {
  configSync: ReturnType<typeof useRealTelemetry>['configSync']
}) {
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
    cfgSync?.kind && (cfgSync.status === 'PENDING' || cfgSync.status === 'OUT_OF_SYNC')
      ? `${cfgSync.kind === 'baseline_setpoint' ? 'Setpoint' : 'Crop Profile'} chưa đồng bộ`
      : 'Không có lệnh nào đang chờ'

  return (
    <div className={`rounded-lg border px-4 py-2 ${cfgColor}`} title={cfgSync?.error?.message ?? ''}>
      <span className="text-[10px] font-semibold uppercase tracking-wider opacity-70">Đồng bộ</span>
      <p className="text-xs mt-0.5">{cfgLabel}</p>
    </div>
  )
}

function HumiditySensorCard() {
  const { humidityCurrent, humidityTrend, humiditySetpoint, mistActive, snapshot } = useRealTelemetry()
  const { humidityOptimalRange } = useBatch()
  const status = getStatus(humidityCurrent, humidityOptimalRange[0], humidityOptimalRange[1], [60, 95])

  return (
    <div className="col-span-1 md:col-span-1 lg:col-span-1">
      <SensorDataCard
        sensorType="humidity"
        currentValue={humidityCurrent}
        setpointValue={humiditySetpoint}
        unit="%"
        status={status}
        trend={humidityTrend}
        actuatorActive={mistActive ?? undefined}
        lastUpdated={snapshot?.time ?? null}
      />
    </div>
  )
}

function TemperatureSensorCard() {
  const { temperatureCurrent, temperatureTrend, temperatureSetpoint, lampStageActive, snapshot } = useRealTelemetry()
  const { tempOptimalRange } = useBatch()
  const status = getStatus(temperatureCurrent, tempOptimalRange[0], tempOptimalRange[1], [20, 40])

  return (
    <div className="col-span-1 md:col-span-1 lg:col-span-1">
      <SensorDataCard
        sensorType="temperature"
        currentValue={temperatureCurrent}
        setpointValue={temperatureSetpoint}
        unit="°C"
        status={status}
        trend={temperatureTrend}
        actuatorActive={lampStageActive ?? undefined}
        lastUpdated={snapshot?.time ?? null}
      />
    </div>
  )
}

function Co2SensorCard() {
  const { co2Current, co2Trend, fanActive, snapshot } = useRealTelemetry()
  const status = getStatus(co2Current, 800, 1200)

  return (
    <div className="col-span-1 md:col-span-1 lg:col-span-1">
      <SensorDataCard
        sensorType="co2"
        currentValue={co2Current}
        setpointValue={1000}
        unit="ppm"
        status={status}
        trend={co2Trend}
        actuatorActive={fanActive ?? undefined}
        lastUpdated={snapshot?.time ?? null}
      />
    </div>
  )
}

function DevelopmentSandboxDrawer({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  if (process.env.NODE_ENV !== 'development') return null
  return (
    <>
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={() => setOpen(true)}
          className="relative flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white rounded-full shadow-lg hover:shadow-amber-500/20 hover:-translate-y-0.5 transition-all duration-300 cursor-pointer font-bold text-xs tracking-wider uppercase group border border-amber-400/25 select-none"
        >
          <Sliders className="w-4 h-4 group-hover:rotate-45 transition-transform duration-300 text-amber-100" />
          <span>Kiểm thử</span>
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end animate-fadeIn">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs cursor-pointer" onClick={() => setOpen(false)} />
          <div className="relative w-80 max-w-[calc(100vw-3rem)] h-full bg-slate-950/95 border-l border-slate-800/80 text-foreground shadow-2xl p-6 flex flex-col justify-between overflow-y-auto animate-slideIn">
            <div>
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-850">
                <div className="flex items-center gap-2">
                  <Sliders className="w-5 h-5 text-amber-500" />
                  <div>
                    <h3 className="font-bold text-sm tracking-wider uppercase text-foreground">Khu vực kiểm thử</h3>
                    <p className="text-[10px] text-muted-foreground">Chỉ dùng để kiểm tra dữ liệu mô phỏng</p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer text-lg font-bold">
                  &times;
                </button>
              </div>
              <SimulationControlPanel />
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function DashboardStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
      .animate-fadeIn { animation: fadeIn 0.2s ease-out forwards; }
      .animate-slideIn { animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    `,
      }}
    />
  )
}

function DashboardContent() {
  const { isLoading, configSync } = useRealTelemetry()
  const { selectedDeviceId } = useSelectedDevice()
  const [sandboxOpen, setSandboxOpen] = useState(false)

  return (
    <DashboardLayout>
      <DashboardStyles />
      {isLoading && (
        <div className="col-span-1 md:col-span-2 lg:col-span-4 rounded-lg border border-slate-700/50 bg-slate-950/50 px-4 py-2 text-xs text-slate-400">
          Đang kết nối để nhận dữ liệu từ phòng nấm…
        </div>
      )}
      <div className="col-span-1 md:col-span-1 lg:col-span-1">
        <TelemetrySyncBadge configSync={configSync} />
      </div>
      <HumiditySensorCard />
      <TemperatureSensorCard />
      <Co2SensorCard />
      <div className="col-span-1 md:col-span-1 lg:col-span-1">
        <BatchStatusPanel />
      </div>
      <div className="col-span-1 md:col-span-2 lg:col-span-2">
        <StandardActuatorsControl />
      </div>
      <div className="col-span-1 md:col-span-2 lg:col-span-4">
        <TuningAdvisoryPanel deviceId={selectedDeviceId} />
      </div>
      <OfflineMonitoringDashboard />
      <div className="col-span-1 md:col-span-2 lg:col-span-4">
        <FuzzyLogicEqualizer />
      </div>
      <DevelopmentSandboxDrawer open={sandboxOpen} setOpen={setSandboxOpen} />
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
