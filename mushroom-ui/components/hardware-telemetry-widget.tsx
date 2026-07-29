'use client'

import { AlertTriangle, Cloud, HardDrive, Timer, Wifi, WifiOff } from 'lucide-react'
import { useRealTelemetry } from '@/lib/real-telemetry-context'
import type { DeviceStatus } from '@/lib/simulation-context'
import { DataAgeTicker } from '@/components/data-age-ticker'

interface HardwareTelemetryWidgetProps {
  sdLoggingActive?: boolean | null
  cloudSynced?: boolean | null
}

function DeviceStatusIndicator({ status }: { status: DeviceStatus }) {
  if (status === 'OFFLINE') {
    return (
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-950/40 border border-red-500/40 animate-pulse"
        title="Thiết bị đã mất tín hiệu"
      >
        <WifiOff className="w-4 h-4 text-red-400" />
        <span className="text-xs font-semibold text-red-400">Mất kết nối</span>
        <AlertTriangle className="w-3 h-3 text-red-400" />
      </div>
    )
  }

  if (status === 'SENSOR_FAULT') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-950/30 border border-red-500/40" title="Thiết bị online nhưng cảm biến không phản hồi">
        <AlertTriangle className="w-4 h-4 text-red-400" />
        <span className="text-xs font-semibold text-red-400">Lỗi cảm biến</span>
      </div>
    )
  }

  if (status === 'DEGRADED_LATENCY') {
    return (
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded bg-amber-950/30 border border-amber-500/40"
        title="Chưa nhận được dữ liệu mới từ thiết bị"
      >
        <Wifi className="w-4 h-4 text-amber-400" />
        <span className="text-xs font-semibold text-amber-400">Kết nối yếu</span>
        <AlertTriangle className="w-3 h-3 text-amber-400" />
      </div>
    )
  }

  if (status === 'ONLINE_ACTIVE') {
    return (
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-900/40 border border-slate-700/50"
        title="Thiết bị đang hoạt động"
      >
        <div className="relative flex items-center justify-center">
          <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-emerald-400 opacity-60" />
          <Wifi className="w-4 h-4 text-emerald-400 relative" />
        </div>
        <span className="text-xs text-muted-foreground">
          <span className="text-emerald-400 font-semibold">Đang kết nối</span>
        </span>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-900/40 border border-slate-700/50"
      title="Đang chờ trạng thái thiết bị..."
    >
      <div className="w-2 h-2 rounded-full bg-slate-500" />
      <span className="text-xs text-slate-500">Đang kết nối...</span>
    </div>
  )
}

export function HardwareTelemetryWidget({
  sdLoggingActive = null,
  cloudSynced = null,
}: HardwareTelemetryWidgetProps) {
  const { deviceStatus, lastTelemetryAt } = useRealTelemetry()
  const lastUpdated = lastTelemetryAt

  const neutralChip = 'border-slate-700/70 bg-slate-900/60 text-slate-400'
  const sdLabel = sdLoggingActive === null ? 'SD: Chưa xác minh' : sdLoggingActive ? 'SD: Đang lưu' : 'SD: Lỗi lưu trữ'
  const cloudLabel = cloudSynced === null ? 'Cloud: Chưa xác minh' : cloudSynced ? 'Cloud: Đã đồng bộ' : 'Cloud: Đang chờ'

  return (
    <div aria-label="Trạng thái hệ thống" className="flex flex-wrap items-center gap-1.5">
      <div title="Trạng thái ghi log SD card chỉ được xác nhận khi telemetry cung cấp dữ liệu." className={`flex h-8 items-center gap-1.5 rounded-lg border px-2 font-mono text-[11px] font-medium ${sdLoggingActive === null ? neutralChip : sdLoggingActive ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300' : 'border-red-500/35 bg-red-950/25 text-red-300'}`}><HardDrive className="size-3.5" />{sdLabel}</div>
      <div title="Trạng thái đồng bộ cloud chỉ được xác nhận khi telemetry cung cấp dữ liệu." className={`flex h-8 items-center gap-1.5 rounded-lg border px-2 font-mono text-[11px] font-medium ${cloudSynced === null ? neutralChip : cloudSynced ? 'border-cyan-500/30 bg-cyan-950/20 text-cyan-300' : 'border-amber-500/35 bg-amber-950/20 text-amber-300'}`}><Cloud className="size-3.5" />{cloudLabel}</div>
      <DeviceStatusIndicator status={deviceStatus} />
      <div className={`flex h-8 items-center gap-1.5 rounded-lg border px-2 font-mono text-[11px] ${lastUpdated ? 'border-slate-700/70 bg-slate-900/60 text-slate-300' : neutralChip}`}><Timer className="size-3.5" />{lastUpdated ? <><span className="hidden xl:inline">Dữ liệu</span><DataAgeTicker timestamp={lastUpdated} /></> : 'Dữ liệu: Chưa có'}</div>
    </div>
  )
}
