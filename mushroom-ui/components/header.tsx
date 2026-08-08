'use client'

import { BellRing, Leaf, Radio, Server, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type RefObject } from 'react'
import Link from 'next/link'

import { DeviceSelector } from '@/components/device-selector'
import { HardwareTelemetryWidget } from '@/components/hardware-telemetry-widget'
import { useRealTelemetry } from '@/lib/real-telemetry-context'
import { useAuth } from '@/lib/auth-context'

function StatusPill({ compact = false }: { compact?: boolean }) {
  const { deviceStatus } = useRealTelemetry()
  const state = deviceStatus === 'ONLINE_ACTIVE'
    ? { label: 'Đang hoạt động', style: 'border-emerald-500/35 bg-emerald-950/30 text-emerald-300' }
    : deviceStatus === 'DEGRADED_LATENCY'
      ? { label: 'Kết nối yếu', style: 'border-amber-500/35 bg-amber-950/30 text-amber-300' }
      : deviceStatus === 'OFFLINE' || deviceStatus === 'SENSOR_FAULT'
        ? { label: deviceStatus === 'OFFLINE' ? 'Mất kết nối' : 'Lỗi cảm biến', style: 'border-red-500/40 bg-red-950/35 text-red-300' }
        : { label: 'Đang kết nối', style: 'border-slate-700 bg-slate-900/70 text-slate-400' }

  return (
    <span
      title={state.label}
      className={`inline-flex items-center rounded-full border font-bold uppercase tracking-wide ${compact ? 'size-5 justify-center p-0' : 'gap-1.5 px-2.5 py-1 text-[10px]'} ${state.style}`}
    >
      <Radio className="size-3" aria-hidden="true" />
      {compact ? <span className="sr-only">{state.label}</span> : state.label}
    </span>
  )
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
  const { user } = useAuth()
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false)

  useEffect(() => {
    if (!deviceMenuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDeviceMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [deviceMenuOpen])

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/90 bg-slate-950/95 backdrop-blur-xl">
      <div className="relative mx-auto grid w-full max-w-[1400px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-1.5 sm:gap-x-3 sm:px-5 sm:py-2.5 lg:grid-cols-[minmax(220px,1fr)_auto] lg:px-8">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-950/40 text-emerald-300 sm:size-10 sm:rounded-xl"><Leaf className="size-[18px] sm:size-5" /></div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2"><h1 className="truncate font-mono text-[13px] font-semibold tracking-tight text-foreground sm:text-base"><span className="sm:hidden">Nhà nấm Beta</span><span className="hidden sm:inline">Nhà nấm rơm Beta</span></h1><span className="sm:hidden"><StatusPill compact /></span><span className="hidden sm:inline"><StatusPill /></span></div>
            <p className="mt-0.5 hidden truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground sm:block">Khu trồng số 1 · 35 trụ</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2">
          <div className="hidden lg:block"><HardwareTelemetryWidget /></div>
          <div className="hidden sm:block"><DeviceSelector /></div>
          {user?.role === 'ADMIN' && (
            <Link
              href="/admin"
              className="flex size-11 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-950/40 text-emerald-300 transition-colors duration-200 hover:bg-emerald-900/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:rounded-xl"
              title="Quản trị hệ thống (Admin Panel)"
            >
              <ShieldCheck className="size-5" />
            </Link>
          )}
          <button type="button" onClick={() => setDeviceMenuOpen((open) => !open)} aria-expanded={deviceMenuOpen} aria-controls="mobile-device-selector" className="flex size-11 cursor-pointer items-center justify-center rounded-lg border border-slate-800 bg-slate-900/55 text-slate-300 transition-colors duration-200 hover:border-slate-600 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:hidden" aria-label="Chọn thiết bị">
            <Server className="size-[18px]" />
          </button>
          <button ref={alertTriggerRef} type="button" onClick={onOpenAlerts} className="relative flex size-11 cursor-pointer items-center justify-center rounded-lg border border-slate-700 bg-slate-900/70 text-slate-300 transition-colors duration-200 hover:border-slate-500 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:rounded-xl" aria-label={`Mở trung tâm cảnh báo${activeAlertCount > 0 ? `, ${activeAlertCount} cảnh báo đang hoạt động` : ''}`}>
            <BellRing className="size-5" />
            {activeAlertCount > 0 && <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-red-500 px-1 py-0.5 text-center text-[9px] font-bold leading-none text-white">{activeAlertCount}</span>}
          </button>
        </div>
        {deviceMenuOpen && (
          <>
            <button type="button" aria-label="Đóng bộ chọn thiết bị" className="fixed inset-x-0 bottom-0 top-14 z-0 cursor-default sm:hidden" onClick={() => setDeviceMenuOpen(false)} />
            <section id="mobile-device-selector" aria-label="Chọn thiết bị" className="absolute right-3 top-[calc(100%+0.5rem)] z-10 w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-slate-700 bg-slate-950 p-3 shadow-xl shadow-black/40 sm:hidden">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Thiết bị đang giám sát</p>
              <DeviceSelector />
            </section>
          </>
        )}
      </div>
    </header>
  )
}
