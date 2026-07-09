'use client'

import { useState } from 'react'
import { Bell, AlertCircle, ChevronDown, LogOut, User, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HardwareTelemetryWidget } from '@/components/hardware-telemetry-widget'
import { useSimulation } from '@/lib/simulation-context'
import { cn } from '@/lib/utils'

export function Header() {
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [alertsVisible, setAlertsVisible] = useState(true)

  const {
    powerSource,
    humidityCurrent,
    temperatureCurrent,
    co2Current,
  } = useSimulation()

  // Generate dynamic, domain-specific alerts based on biological thresholds
  const alerts = []
  
  if (powerSource === 'UPS_BATTERY') {
    alerts.push({
      id: 'ups-alert',
      type: 'critical',
      title: 'UPS Backup Battery Active',
      message: 'Grid failure! Drawing power from backup modules. Prevent collapse!',
    })
  }

  // Humidity alarms
  if (humidityCurrent < 60) {
    alerts.push({
      id: 'hum-crit-low',
      type: 'critical',
      title: 'Danger: Low Humidity',
      message: `RH at ${humidityCurrent.toFixed(1)}% (Opt: 70-90%). Contamination risk!`,
    })
  } else if (humidityCurrent < 70) {
    alerts.push({
      id: 'hum-warn-low',
      type: 'warning',
      title: 'Low Humidity Warning',
      message: `RH at ${humidityCurrent.toFixed(1)}%. Soil/air drying risk.`,
    })
  } else if (humidityCurrent > 95) {
    alerts.push({
      id: 'hum-crit-high',
      type: 'critical',
      title: 'Danger: Oversaturation',
      message: `RH at ${humidityCurrent.toFixed(1)}%. Contamination / pinhead abortion risk!`,
    })
  } else if (humidityCurrent > 90) {
    alerts.push({
      id: 'hum-warn-high',
      type: 'warning',
      title: 'High Humidity Warning',
      message: `RH at ${humidityCurrent.toFixed(1)}%. Oversaturation risk.`,
    })
  }

  // Substrate Temperature alarms
  if (temperatureCurrent < 20) {
    alerts.push({
      id: 'temp-crit-frost',
      type: 'critical',
      title: 'CRITICAL FROST WARNING',
      message: `Substrate is at ${temperatureCurrent.toFixed(1)}°C. Permanent mycelium death below 20°C!`,
    })
  } else if (temperatureCurrent < 28) {
    alerts.push({
      id: 'temp-warn-low',
      type: 'warning',
      title: 'Low Substrate Temperature',
      message: `Substrate is at ${temperatureCurrent.toFixed(1)}°C. Slow tơ growth.`,
    })
  } else if (temperatureCurrent > 38) {
    alerts.push({
      id: 'temp-crit-high',
      type: 'critical',
      title: 'Danger: Substrate Heat Stress',
      message: `Substrate is at ${temperatureCurrent.toFixed(1)}°C. Crop decay risk!`,
    })
  } else if (temperatureCurrent > 35) {
    alerts.push({
      id: 'temp-warn-high',
      type: 'warning',
      title: 'Substrate Heat Warning',
      message: `Substrate is at ${temperatureCurrent.toFixed(1)}°C. Thermal stress risk.`,
    })
  }

  // CO2 alarms
  if (co2Current > 1500) {
    alerts.push({
      id: 'co2-crit-high',
      type: 'critical',
      title: 'High CO2 Ventilation Alert',
      message: `CO2 at ${Math.round(co2Current)} ppm. Deformed elongated stalks risk!`,
    })
  } else if (co2Current > 1200) {
    alerts.push({
      id: 'co2-warn-high',
      type: 'warning',
      title: 'Inadequate Ventilation',
      message: `CO2 at ${Math.round(co2Current)} ppm. Target: 800-1200 ppm.`,
    })
  }

  const notifications = [
    { id: 1, message: 'Crop cycle day updated to simulation standard', time: 'Just now' },
    { id: 2, message: 'Fuzzy logic profile compiled successfully', time: '1 hour ago' },
    { id: 3, message: 'SD Card logging buffer flushed to storage', time: '5 mins ago' },
  ]

  const getAlertBg = (type: string) => {
    return type === 'critical'
      ? 'bg-red-950/40 border-red-500/30'
      : 'bg-yellow-950/30 border-yellow-900/30'
  }

  const getAlertTitleColor = (type: string) => {
    return type === 'critical' ? 'text-red-300 font-bold' : 'text-yellow-300 font-semibold'
  }

  const getAlertMsgColor = (type: string) => {
    return type === 'critical' ? 'text-red-200/90' : 'text-yellow-200/80'
  }

  return (
    <>
      {/* Sticky Alerts Banner */}
      {alertsVisible && alerts.length > 0 && (
        <div className="sticky top-0 z-30 bg-slate-950/60 border-b border-border backdrop-blur-md">
          <div className="flex items-center gap-4 px-4 py-2.5 max-w-full overflow-x-auto">
            <ShieldAlert className="w-5 h-5 text-red-400 flex-shrink-0 animate-bounce" />
            <div className="flex gap-3 flex-1 overflow-x-auto pb-1 scrollbar-none">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={cn(
                    'flex-shrink-0 flex items-center gap-2.5 rounded-lg px-3 py-1.5 border min-w-[280px] max-w-sm transition-all',
                    getAlertBg(alert.type)
                  )}
                >
                  <div className="flex-1 text-xs">
                    <p className={getAlertTitleColor(alert.type)}>{alert.title}</p>
                    <p className={cn('line-clamp-1 mt-0.5', getAlertMsgColor(alert.type))}>{alert.message}</p>
                  </div>
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAlertsVisible(false)}
              className="text-slate-400 hover:text-white flex-shrink-0 w-8 h-8 p-0"
            >
              ✕
            </Button>
          </div>
        </div>
      )}

      {/* Sticky Header */}
      <header className="sticky top-0 z-20 bg-card/40 border-b border-border backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-4">
          {/* Left: Title */}
          <div>
            <h2 className="text-lg font-bold text-foreground tracking-tight flex items-center gap-2">
              Straw Mushroom House Beta
              <span className="text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 uppercase">
                Active
              </span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">NẤM RƠM CP • Pillar House Alpha (35 pillars)</p>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2">
            {/* Hardware Telemetry Widget */}
            <HardwareTelemetryWidget
              powerSource={powerSource === 'GRID_POWER' ? 'grid' : 'ups'}
              batteryPercentage={powerSource === 'GRID_POWER' ? 98 : 74}
              sdLoggingActive={true}
              cloudSynced={powerSource === 'GRID_POWER'}
              systemUptime="7d 12h 34m"
            />

            {/* Notifications */}
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="relative text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setNotificationsOpen(!notificationsOpen)
                  setUserMenuOpen(false)
                }}
              >
                <Bell size={20} />
                <span className="absolute top-1 right-1 w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
              </Button>

              {/* Notifications Dropdown */}
              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-50">
                  <div className="p-4 border-b border-border bg-card/50">
                    <h3 className="font-semibold text-foreground text-sm">System Diagnostics</h3>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className="px-4 py-3 border-b border-border/50 last:border-b-0 hover:bg-muted/50 transition-colors cursor-pointer"
                      >
                        <p className="text-sm text-foreground">{notif.message}</p>
                        <p className="text-xs text-muted-foreground mt-1">{notif.time}</p>
                      </div>
                    ))}
                  </div>
                  <div className="p-3 border-t border-border bg-card/50">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs text-emerald-400 hover:bg-emerald-500/10"
                    >
                      Clear Log Messages
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* User Profile Dropdown */}
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setUserMenuOpen(!userMenuOpen)
                  setNotificationsOpen(false)
                }}
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center">
                  <User size={18} className="text-white" />
                </div>
                <span className="hidden sm:inline text-sm font-medium"> Sarah Chen</span>
                <ChevronDown size={16} className={cn('transition-transform', userMenuOpen && 'rotate-180')} />
              </Button>

              {/* User Menu Dropdown */}
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-50">
                  <div className="p-3 border-b border-border bg-card/50">
                    <p className="text-sm font-semibold text-foreground">Sarah Chen</p>
                    <p className="text-xs text-muted-foreground">Facility Chief</p>
                  </div>
                  <div className="py-2">
                    <button className="w-full px-4 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors flex items-center gap-2 text-left">
                      <User size={16} />
                      User Profile
                    </button>
                    <button className="w-full px-4 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors flex items-center gap-2 text-left">
                      <span className="w-4 h-4">⚙</span>
                      Facility Settings
                    </button>
                  </div>
                  <div className="border-t border-border p-2">
                    <button className="w-full px-4 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-2 text-left">
                      <LogOut size={16} />
                      Disconnect
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
    </>
  )
}
