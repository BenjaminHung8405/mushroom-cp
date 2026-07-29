'use client'

import { DashboardLayout } from '@/components/dashboard-layout'
import { FuzzyLogicEqualizer } from '@/components/fuzzy-logic-equalizer'
import { SensorDataCard } from '@/components/sensor-data-card'
import { SimulationControlPanel } from '@/components/simulation-control-panel'
import { BatchStatusPanel } from '@/components/batch-status-panel'
import { StandardActuatorsControl } from '@/components/standard-actuators-control'
import { OfflineMonitoringDashboard } from '@/components/offline-monitoring-dashboard'
import { TuningAdvisoryPanel } from '@/app/components/tuning/TuningAdvisoryPanel'
import { MobileActionDock } from '@/app/components/mobile-action-dock'
import { OperationalAlertCenter } from '@/app/components/operational-alert-center'
import { OperationalAttentionStrip } from '@/app/components/operational-attention-strip'
import { OperationalSection } from '@/app/components/operational-section'
import { buildOperationalAttention, type OperationalAttentionItem } from '@/app/lib/operational-attention'
import { useOperationalAlerts } from '@/app/lib/operational-alerts'
import { useOperationalHistory } from '@/app/lib/operational-history'
import { usePersistedDeviceSection } from '@/app/lib/use-persisted-device-section'
import { BatchProvider, useBatch } from '@/lib/batch-context'
import { SimulationProvider } from '@/lib/simulation-context'
import { SelectedDeviceProvider, useSelectedDevice } from '@/lib/selected-device-context'
import { RealTelemetryProvider, useRealTelemetry } from '@/lib/real-telemetry-context'
import { AlertTriangle, ChevronRight, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

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

function HumiditySensorCard() {
  const { humidityCurrent, humidityTrend, humiditySetpoint, mistActive, snapshot } = useRealTelemetry()
  const { humidityOptimalRange } = useBatch()
  const status = getStatus(humidityCurrent, humidityOptimalRange[0], humidityOptimalRange[1], [60, 95])

  return <SensorDataCard sensorType="humidity" currentValue={humidityCurrent} setpointValue={humiditySetpoint} unit="%" status={status} trend={humidityTrend} actuatorActive={mistActive ?? undefined} lastUpdated={snapshot?.time ?? null} />
}

function TemperatureSensorCard() {
  const { temperatureCurrent, temperatureTrend, temperatureSetpoint, lampStageActive, snapshot } = useRealTelemetry()
  const { tempOptimalRange } = useBatch()
  const status = getStatus(temperatureCurrent, tempOptimalRange[0], tempOptimalRange[1], [20, 38])

  return <SensorDataCard sensorType="temperature" currentValue={temperatureCurrent} setpointValue={temperatureSetpoint} unit="°C" status={status} trend={temperatureTrend} actuatorActive={lampStageActive ?? undefined} lastUpdated={snapshot?.time ?? null} />
}

function Co2SensorCard() {
  const { co2Current, co2Trend, fanActive, snapshot } = useRealTelemetry()
  const status = getStatus(co2Current, 800, 1200, [0, 1500])

  return <SensorDataCard sensorType="co2" currentValue={co2Current} setpointValue={1000} unit="ppm" status={status} trend={co2Trend} actuatorActive={fanActive ?? undefined} lastUpdated={snapshot?.time ?? null} />
}

function CriticalAlertBanner({ entries, onOpenAlerts }: {
  entries: ReturnType<typeof useOperationalAlerts>
  onOpenAlerts: () => void
}) {
  const criticalEntries = entries.filter((entry) => entry.active && entry.severity === 'critical')
  if (criticalEntries.length === 0) return null

  const first = criticalEntries[0]
  return (
    <section aria-live="assertive" className="sticky top-0 z-30 mb-4 rounded-xl border border-red-500/55 bg-red-950/90 px-4 py-3 shadow-lg shadow-red-950/30 backdrop-blur-md">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wide text-red-200">Cảnh báo sinh tồn</p>
          <p className="mt-0.5 text-sm font-semibold text-red-50">{first.title}</p>
          <p className="mt-1 text-xs leading-5 text-red-100/90">{first.message}</p>
        </div>
        <button type="button" onClick={onOpenAlerts} className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-red-400/40 px-3 text-xs font-semibold text-red-100 transition-colors duration-200 hover:bg-red-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200">
          Xem <ChevronRight className="size-4" />
        </button>
      </div>
    </section>
  )
}

function DevelopmentSandboxDrawer({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  if (process.env.NODE_ENV !== 'development') return null
  return (
    <>
      <div className="fixed bottom-24 right-4 z-50 md:bottom-6 md:right-6">
        <button type="button" onClick={() => setOpen(true)} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-amber-400/25 bg-amber-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white shadow-lg transition-colors duration-200 hover:bg-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200">
          <SlidersHorizontal className="size-4" />Kiểm thử
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <button type="button" aria-label="Đóng khu vực kiểm thử" className="absolute inset-0 cursor-default bg-slate-950/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-80 max-w-[calc(100vw-2rem)] overflow-y-auto border-l border-slate-800 bg-slate-950 p-5 shadow-2xl">
            <div className="mb-5 flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div><h2 className="font-mono text-sm font-semibold text-foreground">Khu vực kiểm thử</h2><p className="mt-1 text-xs text-muted-foreground">Chỉ dùng để kiểm tra dữ liệu mô phỏng.</p></div>
              <button type="button" onClick={() => setOpen(false)} className="flex size-11 cursor-pointer items-center justify-center rounded-lg border border-slate-700 text-lg text-slate-300 transition-colors duration-200 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" aria-label="Đóng">×</button>
            </div>
            <SimulationControlPanel />
          </aside>
        </div>
      )}
    </>
  )
}

function DashboardContent() {
  const telemetry = useRealTelemetry()
  const { selectedDeviceId } = useSelectedDevice()
  const [alertsOpen, setAlertsOpen] = useState(false)
  const [alertTab, setAlertTab] = useState<'critical' | 'warning' | 'system'>('critical')
  const [sandboxOpen, setSandboxOpen] = useState(false)
  const [focusedChatterAt, setFocusedChatterAt] = useState<number | null>(null)
  const alertTriggerRef = useRef<HTMLButtonElement>(null)
  const controlsRef = useRef<HTMLElement>(null)
  const analysisRef = useRef<HTMLElement>(null)
  const curvesRef = useRef<HTMLElement>(null)
  const analysisSection = usePersistedDeviceSection('analysis', selectedDeviceId)
  const curvesSection = usePersistedDeviceSection('curves', selectedDeviceId)
  const history = useOperationalHistory(selectedDeviceId)
  const entries = useOperationalAlerts({
    deviceId: selectedDeviceId,
    temperature: telemetry.temperatureCurrent,
    humidity: telemetry.humidityCurrent,
    co2: telemetry.co2Current,
    deviceStatus: telemetry.deviceStatus,
    lastTelemetryAt: telemetry.lastTelemetryAt,
    blackoutActive: telemetry.middayBlackoutActive,
    configSyncStatus: telemetry.configSync?.status,
  })
  const activeAlertCount = useMemo(() => entries.filter((entry) => entry.active && entry.severity !== 'system').length, [entries])
  const attentionItems = useMemo(
    () => buildOperationalAttention(entries, history.summary),
    [entries, history.summary],
  )

  const openAlerts = () => {
    setAlertTab(entries.some((entry) => entry.active && entry.severity === 'critical') ? 'critical' : 'warning')
    setAlertsOpen(true)
  }
  const scrollTo = (ref: React.RefObject<HTMLElement | null>) => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const openCurves = () => {
    curvesSection.setOpen(true)
  }

  useEffect(() => {
    if (!curvesSection.open) return
    const frame = window.requestAnimationFrame(() => scrollTo(curvesRef))
    return () => window.cancelAnimationFrame(frame)
  }, [curvesSection.open])

  const handleAttention = (item: OperationalAttentionItem) => {
    if (item.target === 'alerts') {
      openAlerts()
      return
    }
    if (item.target === 'curves') {
      setFocusedChatterAt(null)
      curvesSection.setOpen(true)
      window.requestAnimationFrame(() => scrollTo(curvesRef))
      return
    }
    setFocusedChatterAt(item.focusChatterAt ?? null)
    analysisSection.setOpen(true)
    window.requestAnimationFrame(() => scrollTo(analysisRef))
  }

  return (
    <DashboardLayout onOpenAlerts={openAlerts} activeAlertCount={activeAlertCount} alertTriggerRef={alertTriggerRef}>
      <CriticalAlertBanner entries={entries} onOpenAlerts={openAlerts} />
      {telemetry.isLoading && <div className="mb-4 rounded-xl border border-slate-700/50 bg-slate-950/50 px-4 py-3 text-xs text-slate-400">Đang kết nối để nhận dữ liệu từ phòng nấm…</div>}
      <OperationalAttentionStrip items={attentionItems} onSelect={handleAttention} />

      <section id="overview" aria-label="Tổng quan vận hành" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12 lg:gap-4">
        <div className="lg:col-span-4"><TemperatureSensorCard /></div>
        <div className="lg:col-span-4"><HumiditySensorCard /></div>
        <div className="lg:col-span-4"><Co2SensorCard /></div>
        <div className="lg:col-span-4"><BatchStatusPanel /></div>
        <section ref={controlsRef} id="controls" className="scroll-mt-24 lg:col-span-8"><StandardActuatorsControl /></section>
      </section>

      <div className="mt-4 space-y-4">
        <section ref={analysisRef} className="scroll-mt-24">
          <OperationalSection id="operations-analysis" title="Phân tích vận hành" description="Vi khí hậu 24 giờ, lịch sử thiết bị và sức khỏe hệ thống" open={analysisSection.open} onOpenChange={analysisSection.setOpen}>
            {analysisSection.open && <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><OfflineMonitoringDashboard history={history} focusChatterAt={focusedChatterAt} /></div>}
          </OperationalSection>
        </section>
        <section ref={curvesRef} className="scroll-mt-24">
          <OperationalSection id="curves-and-tuning" title="Đường cong & tinh chỉnh" description="Cấu hình Fuzzy Logic và khuyến nghị điều chỉnh" open={curvesSection.open} onOpenChange={curvesSection.setOpen}>
            <div className="space-y-4"><TuningAdvisoryPanel deviceId={selectedDeviceId} /><FuzzyLogicEqualizer /></div>
          </OperationalSection>
        </section>
      </div>

      <OperationalAlertCenter entries={entries} open={alertsOpen} onClose={() => setAlertsOpen(false)} triggerRef={alertTriggerRef} activeTab={alertTab} onTabChange={setAlertTab} />
      <MobileActionDock onOpenAlerts={openAlerts} onOpenControls={() => scrollTo(controlsRef)} onOpenCurves={openCurves} activeAlertCount={activeAlertCount} alertTriggerRef={alertTriggerRef} />
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
