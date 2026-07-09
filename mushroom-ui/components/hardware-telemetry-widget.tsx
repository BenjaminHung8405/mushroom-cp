'use client'

import { useState, useEffect } from 'react'
import { Battery, Zap, HardDrive, Cloud, Activity } from 'lucide-react'

interface HardwareTelemetryWidgetProps {
  powerSource?: 'grid' | 'ups'
  batteryPercentage?: number
  sdLoggingActive?: boolean
  cloudSynced?: boolean
  systemUptime?: string
}

export function HardwareTelemetryWidget({
  powerSource = 'grid',
  batteryPercentage = 85,
  sdLoggingActive = true,
  cloudSynced = true,
  systemUptime = '7d 12h 34m',
}: HardwareTelemetryWidgetProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="flex items-center gap-4 px-4 py-2">
      {/* Power Source Status */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-900/40 border border-slate-700/50 hover:border-slate-600/50 cursor-pointer transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}>
        {powerSource === 'grid' ? (
          <>
            <Zap className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold text-emerald-400">Grid Power</span>
          </>
        ) : (
          <>
            <Battery className="w-4 h-4 text-amber-400" />
            <span className="text-xs font-semibold text-amber-400">UPS Active</span>
          </>
        )}
        <div className="w-6 h-3 rounded bg-slate-800 border border-slate-700 p-0.5">
          <div
            className={`h-full rounded transition-all ${
              powerSource === 'grid' ? 'bg-emerald-500' : 'bg-amber-500'
            }`}
            style={{ width: `${batteryPercentage}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground">{batteryPercentage}%</span>
      </div>

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

      {/* System Status Indicator */}
      <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-900/40 border border-slate-700/50">
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-xs text-muted-foreground">
          <span className="hidden sm:inline">Online</span>
        </span>
      </div>

      {/* Expanded Details (Mobile/Compact View) */}
      {isExpanded && (
        <div className="absolute top-16 right-4 bg-slate-900 border border-slate-700 rounded-lg p-4 shadow-lg z-50 min-w-max">
          <div className="space-y-2 text-xs">
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Power Source:</span>
              <span className="text-foreground font-semibold">
                {powerSource === 'grid' ? 'Grid' : 'UPS Backup'}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Battery:</span>
              <span className="text-foreground font-semibold">{batteryPercentage}%</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">SD Logging:</span>
              <span className={sdLoggingActive ? 'text-blue-400' : 'text-red-400'}>
                {sdLoggingActive ? 'Active (5-min intervals)' : 'Inactive'}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-muted-foreground">Cloud Sync:</span>
              <span className={cloudSynced ? 'text-cyan-400' : 'text-amber-400'}>
                {cloudSynced ? 'Synced (now)' : 'Pending (5 records)'}
              </span>
            </div>
            <div className="border-t border-slate-700 pt-2 mt-2 flex justify-between gap-4">
              <span className="text-muted-foreground">System Uptime:</span>
              <span className="text-foreground font-semibold">{systemUptime}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
