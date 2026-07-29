'use client'

import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

export function OperationalSection({
  id,
  title,
  description,
  open,
  onOpenChange,
  children,
}: {
  id: string
  title: string
  description: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-slate-800 bg-slate-950/50">
      <button type="button" aria-expanded={open} aria-controls={`${id}-content`} onClick={() => onOpenChange(!open)} className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-4 rounded-2xl px-4 py-3 text-left transition-colors duration-200 hover:bg-slate-900/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400">
        <span><span className="block font-mono text-sm font-semibold text-foreground">{title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{description}</span></span>
        <ChevronDown className={`size-5 shrink-0 text-emerald-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div id={`${id}-content`} className="border-t border-slate-800 p-3 sm:p-4">{children}</div>}
    </section>
  )
}
