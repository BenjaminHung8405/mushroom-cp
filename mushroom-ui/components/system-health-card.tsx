'use client'

import { Activity, Cpu, Radio, TriangleAlert } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { DeviceStatusEvent } from '@/lib/telemetry-api'

const healthStyle = {
  ONLINE_ACTIVE: 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300',
  DEGRADED_LATENCY: 'border-amber-500/40 bg-amber-950/20 text-amber-300',
  SENSOR_FAULT: 'border-red-500/40 bg-red-950/20 text-red-300',
  OFFLINE: 'border-red-500/40 bg-red-950/20 text-red-300',
  UNKNOWN: 'border-slate-700 text-slate-400',
} as const

const healthLabel: Record<keyof typeof healthStyle, string> = {
  ONLINE_ACTIVE: 'Đang hoạt động',
  DEGRADED_LATENCY: 'Tín hiệu chậm',
  SENSOR_FAULT: 'Cảm biến lỗi',
  OFFLINE: 'Mất kết nối',
  UNKNOWN: 'Chưa xác định',
}

export function SystemHealthCard({
  latestPoint,
  status,
}: {
  latestPoint: { bootCount: number | null; time: string } | null
  status: DeviceStatusEvent['health'] | 'UNKNOWN'
}) {
  const label = healthLabel[status] ?? healthLabel.UNKNOWN
  const bootCount = latestPoint?.bootCount ?? null
  return (
    <Card className="col-span-1 border border-slate-700/60 bg-slate-950/50 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Cpu className="h-5 w-5 text-cyan-400" />
        <h3 className="font-semibold">Sức khỏe hệ thống</h3>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
          <div className="flex items-center gap-1 text-xs text-slate-400"><Activity className="h-3.5 w-3.5" /> Số lần khởi động</div>
          {bootCount === null ? (
            <span className="mt-2 inline-flex items-center rounded-full border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[10px] text-slate-400">
              Chưa có dữ liệu 24h
            </span>
          ) : (
            <p className="mt-1 text-2xl font-bold">{bootCount}</p>
          )}
        </div>
        <div className={`rounded-lg border p-3 ${healthStyle[status]}`}>
          <div className="flex items-center gap-1 text-xs opacity-80"><Radio className="h-3.5 w-3.5" /> Kết nối</div>
          <p className="mt-1 text-sm font-bold">{label}</p>
          {status === 'DEGRADED_LATENCY' || status === 'SENSOR_FAULT' ? <TriangleAlert className="mt-1 h-4 w-4" /> : null}
        </div>
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        {latestPoint ? `Dữ liệu ngoại tuyến gần nhất: ${new Date(latestPoint.time).toLocaleString('vi-VN')}` : 'Chưa có dữ liệu 24 giờ.'}
      </p>
    </Card>
  )
}
