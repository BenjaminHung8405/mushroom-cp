'use client'

import { BellRing, ChartSpline, SlidersHorizontal } from 'lucide-react'
import type { RefObject } from 'react'

export function MobileActionDock({
  onOpenAlerts,
  onOpenControls,
  onOpenCurves,
  activeAlertCount,
  alertTriggerRef,
}: {
  onOpenAlerts: () => void
  onOpenControls: () => void
  onOpenCurves: () => void
  activeAlertCount: number
  alertTriggerRef: RefObject<HTMLButtonElement | null>
}) {
  return (
    <nav aria-label="Thao tác nhanh" className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-700/90 bg-slate-950/95 px-3 pb-[env(safe-area-inset-bottom)] pt-2 shadow-[0_-10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl md:hidden">
      <div className="mx-auto grid max-w-md grid-cols-3 gap-2">
        <button ref={alertTriggerRef} type="button" onClick={onOpenAlerts} className="relative flex min-h-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-semibold text-slate-300 transition-colors duration-200 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"><BellRing className="size-5" /><span>Cảnh báo</span>{activeAlertCount > 0 && <span className="absolute right-3 top-1 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] leading-none text-white">{activeAlertCount}</span>}</button>
        <button type="button" onClick={onOpenControls} className="flex min-h-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-semibold text-slate-300 transition-colors duration-200 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"><SlidersHorizontal className="size-5" /><span>Điều khiển</span></button>
        <button type="button" onClick={onOpenCurves} className="flex min-h-11 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg text-xs font-semibold text-slate-300 transition-colors duration-200 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"><ChartSpline className="size-5" /><span>Đường cong</span></button>
      </div>
    </nav>
  )
}
