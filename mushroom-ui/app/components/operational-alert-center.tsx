'use client'

import { Activity, AlertTriangle, ShieldAlert, X } from 'lucide-react'
import { useEffect, useMemo, useRef, type RefObject } from 'react'

import type { AlertEntry } from '@/app/lib/operational-alerts'

type AlertTab = 'critical' | 'warning' | 'system'

const tabs: Array<{ id: AlertTab; label: string }> = [
  { id: 'critical', label: 'Nguy hại' },
  { id: 'warning', label: 'Cảnh báo' },
  { id: 'system', label: 'Hệ thống' },
]

function filterEntries(entries: AlertEntry[], tab: AlertTab) {
  if (tab === 'critical') return entries.filter((entry) => entry.severity === 'critical')
  if (tab === 'warning') return entries.filter((entry) => entry.severity === 'warning')
  return entries.filter((entry) => entry.severity === 'system')
}

function severityStyle(severity: AlertEntry['severity']) {
  if (severity === 'critical') return 'border-red-500/40 bg-red-950/35 text-red-100'
  if (severity === 'warning') return 'border-amber-500/40 bg-amber-950/30 text-amber-100'
  return 'border-cyan-500/35 bg-cyan-950/25 text-cyan-100'
}

export function OperationalAlertCenter({
  entries,
  open,
  onClose,
  triggerRef,
  activeTab,
  onTabChange,
}: {
  entries: AlertEntry[]
  open: boolean
  onClose: () => void
  triggerRef: RefObject<HTMLButtonElement | null>
  activeTab: AlertTab
  onTabChange: (tab: AlertTab) => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const visibleEntries = useMemo(() => filterEntries(entries, activeTab), [entries, activeTab])

  const close = () => {
    onClose()
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    const firstButton = dialog?.querySelector<HTMLElement>('button:not([disabled])')
    firstButton?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open]) // close only relies on stable refs/state setters from the render that opened it.

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 md:items-center md:p-6">
      <button aria-label="Đóng trung tâm cảnh báo" className="absolute inset-0 cursor-default bg-slate-950/75 backdrop-blur-sm" onClick={close} />
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="alert-center-title" className="relative flex max-h-[80dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-700 bg-slate-950 shadow-2xl md:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-2 text-red-300"><ShieldAlert className="size-5" /></div>
            <div>
              <h2 id="alert-center-title" className="font-mono text-sm font-semibold text-foreground">Trung tâm cảnh báo</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Nhật ký trong phiên đang mở</p>
            </div>
          </div>
          <button type="button" onClick={close} className="flex size-11 cursor-pointer items-center justify-center rounded-lg border border-slate-700 text-slate-300 transition-colors duration-200 hover:border-slate-500 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" aria-label="Đóng trung tâm cảnh báo"><X className="size-5" /></button>
        </div>
        <div className="grid grid-cols-3 gap-1 border-b border-slate-800 p-2" role="tablist" aria-label="Loại cảnh báo">
          {tabs.map((tab) => {
            const count = filterEntries(entries, tab.id).filter((entry) => entry.active).length
            return <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => onTabChange(tab.id)} className={`min-h-11 cursor-pointer rounded-lg px-2 text-xs font-semibold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${activeTab === tab.id ? 'bg-slate-800 text-foreground' : 'text-muted-foreground hover:bg-slate-900 hover:text-foreground'}`}>{tab.label}{count > 0 && <span className="ml-1.5 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-200">{count}</span>}</button>
          })}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {visibleEntries.length === 0 ? (
            <div className="flex min-h-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-800 text-center text-sm text-muted-foreground"><Activity className="size-5 text-slate-600" />Không có {tabs.find((tab) => tab.id === activeTab)?.label.toLowerCase()} trong phiên này.</div>
          ) : visibleEntries.map((entry) => (
            <article key={`${entry.id}-${entry.createdAt}`} className={`rounded-xl border p-3 ${severityStyle(entry.severity)}`}>
              <div className="flex gap-3"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><h3 className="text-sm font-semibold">{entry.title}</h3><span className={`shrink-0 text-[10px] font-semibold ${entry.active ? '' : 'opacity-60'}`}>{entry.active ? 'Đang hoạt động' : 'Đã ổn định'}</span></div><p className="mt-1 text-xs leading-5 opacity-90">{entry.message}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] opacity-70"><span>{new Date(entry.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</span><span>Nguồn: {entry.source}</span>{entry.groupCount > 1 && <span>Đã gộp {entry.groupCount} lần</span>}</div></div></div>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}
