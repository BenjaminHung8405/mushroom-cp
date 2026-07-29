'use client'

import { BellRing, Leaf, Radio } from 'lucide-react'
import type { RefObject } from 'react'

import { DeviceSelector } from '@/components/device-selector'
import { HardwareTelemetryWidget } from '@/components/hardware-telemetry-widget'
import { useRealTelemetry } from '@/lib/real-telemetry-context'

function StatusPill() {
  const { deviceStatus } = useRealTelemetry()
  const state = deviceStatus === 'ONLINE_ACTIVE'
    ? { label: 'Đang hoạt động', style: 'border-emerald-500/35 bg-emerald-950/30 text-emerald-300' }
    : deviceStatus === 'DEGRADED_LATENCY'
      ? { label: 'Kết nối yếu', style: 'border-amber-500/35 bg-amber-950/30 text-amber-300' }
      : deviceStatus === 'OFFLINE' || deviceStatus === 'SENSOR_FAULT'
        ? { label: deviceStatus === 'OFFLINE' ? 'Mất kết nối' : 'Lỗi cảm biến', style: 'border-red-500/40 bg-red-950/35 text-red-300' }
        : { label: 'Đang kết nối', style: 'border-slate-700 bg-slate-900/70 text-slate-400' }

  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${state.style}`}><Radio className="size-3" />{state.label}</span>
}

export function Header({
  onOpenAlerts,
  activeAlertCount,
  alertTriggerRef,
}: {
  onOpenAlerts: () => void
  activeAlertCount: number
  alertTriggerRef: RefObject<HTMLButtonElement | null>
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/90 bg-slate-950/90 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-3 px-3 py-3 sm:px-5 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-950/40 text-emerald-300"><Leaf className="size-5" /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h1 className="truncate font-mono text-sm font-semibold tracking-tight text-foreground sm:text-base">Nhà nấm rơm Beta</h1><StatusPill /></div>
            <p className="mt-0.5 truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Khu trồng số 1 · 35 trụ</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <div className="hidden lg:block"><HardwareTelemetryWidget /></div>
          <div className="hidden sm:block"><DeviceSelector /></div>
          <button ref={alertTriggerRef} type="button" onClick={onOpenAlerts} className="relative flex size-11 cursor-pointer items-center justify-center rounded-xl border border-slate-700 bg-slate-900/70 text-slate-300 transition-colors duration-200 hover:border-slate-500 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" aria-label={`Mở trung tâm cảnh báo${activeAlertCount > 0 ? `, ${activeAlertCount} cảnh báo đang hoạt động` : ''}`}>
            <BellRing className="size-5" />
            {activeAlertCount > 0 && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-red-500 px-1 py-0.5 text-center text-[9px] font-bold leading-none text-white">{activeAlertCount}</span>}
          </button>
        </div>
      </div>
      <div className="border-t border-slate-800/70 px-3 py-2 sm:hidden"><DeviceSelector /></div>
    </header>
  )
}
