'use client'

import { Activity, ChevronRight, TriangleAlert } from 'lucide-react'

import type { OperationalAttentionItem } from '@/app/lib/operational-attention'

export function OperationalAttentionStrip({
  items,
  onSelect,
}: {
  items: OperationalAttentionItem[]
  onSelect: (item: OperationalAttentionItem) => void
}) {
  if (items.length === 0) return null

  return (
    <section aria-label="Các điểm cần chú ý" className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-950/15 p-2 sm:p-3">
      <div className="mb-2 flex items-center gap-2 px-2 text-xs font-semibold text-amber-200"><TriangleAlert className="size-4" />Cần chú ý</div>
      <div className="grid gap-2 lg:grid-cols-2">
        {items.map((item) => (
          <div key={item.id} className="flex min-w-0 items-center gap-3 rounded-xl bg-slate-950/65 px-3 py-2.5">
            <Activity className="size-4 shrink-0 text-amber-400" aria-hidden="true" />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-100">{item.title}</p><p className="mt-0.5 line-clamp-1 text-xs text-slate-400">{item.description}</p></div>
            <button type="button" onClick={() => onSelect(item)} className="flex min-h-11 shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-semibold text-amber-200 transition-colors duration-200 hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300">Chi tiết<ChevronRight className="size-4" /></button>
          </div>
        ))}
      </div>
    </section>
  )
}
