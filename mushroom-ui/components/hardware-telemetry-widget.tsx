'use client'

import { Cloud, HardDrive, Wifi, WifiOff, AlertTriangle } from 'lucide-react'
import { useSimulation, DeviceStatus } from '@/lib/simulation-context'

interface HardwareTelemetryWidgetProps {
  sdLoggingActive?: boolean
  cloudSynced?: boolean
  systemUptime?: string
}

/**
 * HardwareTelemetryWidget
 *
 * Displays real-time hardware status indicators in the header:
 *   - SD Card logging status
 *   - Cloud sync status
 *   - Device connection status (driven by MQTT LWT events)
 *
 * Device Status Visual Encoding:
 *   🟢 Emerald + pulse  = online (ESP32-S3 actively connected)
 *   🔴 Crimson + shake  = offline (EMQX fired LWT — device lost)
 *   ⚪ Slate             = unknown (waiting for first status event)
 */
function DeviceStatusIndicator({ status }: { status: DeviceStatus }) {
  if (status === 'offline') {
    return (
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded bg-red-950/40 border border-red-500/40 animate-pulse"
        title="Thiết bị mất kết nối — EMQX đã kích hoạt Last Will and Testament"
      >
        <WifiOff className="w-4 h-4 text-red-400" />
        <span className="text-xs font-semibold text-red-400">
          Mất kết nối
        </span>
        <AlertTriangle className="w-3 h-3 text-red-400" />
      </div>
    )
  }

  if (status === 'online') {
    return (
      <div
        className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-900/40 border border-slate-700/50"
        title="ESP32-S3 đang hoạt động"
      >
        <div className="relative flex items-center justify-center">
          <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-emerald-400 opacity-60" />
          <Wifi className="w-4 h-4 text-emerald-400 relative" />
        </div>
        <span className="text-xs text-muted-foreground">
          <span className="text-emerald-400 font-semibold">Online</span>
        </span>
      </div>
    )
  }

  // Unknown state: initial load or no status received yet
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
  sdLoggingActive = true,
  cloudSynced = true,
}: HardwareTelemetryWidgetProps) {
  const { deviceStatus } = useSimulation()

  return (
    <div className="flex items-center gap-3 px-4 py-2">
      {/* SD Logging Status */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-900/40 border border-slate-700/50 hover:border-slate-600/50 cursor-pointer transition-colors">
        <HardDrive className="w-4 h-4 text-blue-400" />
        <span className="text-xs text-muted-foreground">
          SD: <span className={sdLoggingActive ? 'text-blue-400 font-semibold' : 'text-red-400'}>
            {sdLoggingActive ? 'Active' : 'Offline'}
          </span>
        </span>
        <span className="text-xs text-slate-600">(5m)</span>
      </div>

      {/* Cloud Sync Status */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-900/40 border border-slate-700/50 hover:border-slate-600/50 cursor-pointer transition-colors">
        <Cloud className="w-4 h-4 text-cyan-400" />
        <span className="text-xs text-muted-foreground">
          Cloud: <span className={cloudSynced ? 'text-cyan-400 font-semibold' : 'text-amber-400'}>
            {cloudSynced ? 'Synced' : 'Pending'}
          </span>
        </span>
      </div>

      {/* Device Connection Status (LWT-driven) */}
      <DeviceStatusIndicator status={deviceStatus} />
    </div>
  )
}
