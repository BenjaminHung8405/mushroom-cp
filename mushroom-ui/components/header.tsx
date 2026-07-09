'use client'

import { Button } from '@/components/ui/button'
import { HardwareTelemetryWidget } from '@/components/hardware-telemetry-widget'
import { useSimulation } from '@/lib/simulation-context'
import { cn } from '@/lib/utils'
import { Bell, ChevronDown, LogOut, Settings2, ShieldAlert, User, WifiOff, X } from 'lucide-react'
import { useState } from 'react'

export function Header() {
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [alertsVisible, setAlertsVisible] = useState(true)
  const [deviceAlertDismissed, setDeviceAlertDismissed] = useState(false)

  const {
    humidityCurrent,
    temperatureCurrent,
    co2Current,
    deviceStatus,
    monitoredDeviceId,
  } = useSimulation()

  // Reset the device alert banner whenever status changes back to online
  // (so if it reconnects, the banner can reappear if it goes offline again)
  const showDeviceOfflineAlert = deviceStatus === 'offline' && !deviceAlertDismissed

  // Generate dynamic, domain-specific alerts based on biological thresholds
  const alerts = []

  // Humidity alarms
  if (humidityCurrent < 60) {
    alerts.push({
      id: 'hum-crit-low',
      type: 'critical',
      title: 'Nguy hiểm: Độ ẩm thấp',
      message: `RH hiện tại ${humidityCurrent.toFixed(1)}% (tối ưu: 70-90%). Nguy cơ nhiễm tạp cao.`,
    })
  } else if (humidityCurrent < 70) {
    alerts.push({
      id: 'hum-warn-low',
      type: 'warning',
      title: 'Cảnh báo độ ẩm thấp',
      message: `RH hiện tại ${humidityCurrent.toFixed(1)}%. Nguy cơ khô bề mặt và không khí.`,
    })
  } else if (humidityCurrent > 95) {
    alerts.push({
      id: 'hum-crit-high',
      type: 'critical',
      title: 'Nguy hiểm: Quá bão hòa ẩm',
      message: `RH hiện tại ${humidityCurrent.toFixed(1)}%. Nguy cơ nhiễm tạp và rụng đầu kim.`,
    })
  } else if (humidityCurrent > 90) {
    alerts.push({
      id: 'hum-warn-high',
      type: 'warning',
      title: 'Cảnh báo độ ẩm cao',
      message: `RH hiện tại ${humidityCurrent.toFixed(1)}%. Có nguy cơ bão hòa quá mức.`,
    })
  }

  // Substrate Temperature alarms
  if (temperatureCurrent < 20) {
    alerts.push({
      id: 'temp-crit-frost',
      type: 'critical',
      title: 'CẢNH BÁO LẠNH NGUY HIỂM',
      message: `Giá thể đang ở ${temperatureCurrent.toFixed(1)}°C. Dưới 20°C có thể gây chết tơ vĩnh viễn.`,
    })
  } else if (temperatureCurrent < 28) {
    alerts.push({
      id: 'temp-warn-low',
      type: 'warning',
      title: 'Nhiệt độ giá thể thấp',
      message: `Giá thể đang ở ${temperatureCurrent.toFixed(1)}°C. Tốc độ nuôi tơ sẽ chậm lại.`,
    })
  } else if (temperatureCurrent > 38) {
    alerts.push({
      id: 'temp-crit-high',
      type: 'critical',
      title: 'Nguy hiểm: Nhiệt giá thể quá cao',
      message: `Giá thể đang ở ${temperatureCurrent.toFixed(1)}°C. Nguy cơ suy giảm lứa trồng.`,
    })
  } else if (temperatureCurrent > 35) {
    alerts.push({
      id: 'temp-warn-high',
      type: 'warning',
      title: 'Cảnh báo nhiệt giá thể cao',
      message: `Giá thể đang ở ${temperatureCurrent.toFixed(1)}°C. Có nguy cơ sốc nhiệt.`,
    })
  }

  // CO2 alarms
  if (co2Current > 1500) {
    alerts.push({
      id: 'co2-crit-high',
      type: 'critical',
      title: 'Cảnh báo CO2 cao',
      message: `CO2 hiện tại ${Math.round(co2Current)} ppm. Nguy cơ thân nấm kéo dài, biến dạng.`,
    })
  } else if (co2Current > 1200) {
    alerts.push({
      id: 'co2-warn-high',
      type: 'warning',
      title: 'Thông gió chưa đạt',
      message: `CO2 hiện tại ${Math.round(co2Current)} ppm. Mục tiêu: 800-1200 ppm.`,
    })
  }

  const notifications = [
    { id: 1, message: 'Ngày chu kỳ cây trồng đã được cập nhật theo mô phỏng', time: 'Vừa xong' },
    { id: 2, message: 'Hồ sơ logic mờ đã biên dịch thành công', time: '1 giờ trước' },
    { id: 3, message: 'Bộ đệm ghi SD đã được đẩy vào lưu trữ', time: '5 phút trước' },
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
      {/* ================================================================
          DEVICE OFFLINE CRITICAL BANNER (LWT-triggered)
          Shown when EMQX fires the Last Will and Testament message.
          Color: Crimson (#DC143C) — highest urgency.
          ================================================================ */}
      {showDeviceOfflineAlert && (
        <div
          className="sticky top-0 z-40 border-b border-red-500/50"
          style={{ background: 'linear-gradient(90deg, #1a0505 0%, #2d0808 50%, #1a0505 100%)' }}
        >
          <div className="flex items-center gap-3 px-4 py-2.5">
            <div className="flex items-center gap-2 flex-shrink-0">
              <WifiOff className="w-5 h-5 animate-pulse" style={{ color: '#DC143C' }} />
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#DC143C' }}>
                ⚠ Thiết bị mất kết nối
              </span>
            </div>
            <div className="flex-1 text-xs text-red-200/80">
              ESP32-S3 tại nhà nấm (<code className="bg-red-900/40 px-1 rounded text-red-300">{monitoredDeviceId}</code>)
              đã mất tín hiệu. EMQX đã kích hoạt Last Will and Testament.
              Kiểm tra nguồn điện và kết nối mạng tại thực địa.
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeviceAlertDismissed(true)}
              className="flex-shrink-0 w-7 h-7 p-0 text-red-400 hover:text-white hover:bg-red-900/40"
            >
              <X size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* Environmental alerts banner */}
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
              <X size={16} />
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
              Nhà nấm rơm Beta
              {/* Dynamic status badge: green=online, red=offline */}
              {deviceStatus === 'offline' ? (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase animate-pulse"
                  style={{ background: 'rgba(220,20,60,0.12)', color: '#DC143C', borderColor: 'rgba(220,20,60,0.35)' }}>
                  Mất kết nối
                </span>
              ) : deviceStatus === 'online' ? (
                <span className="text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 uppercase">
                  Đang hoạt động
                </span>
              ) : (
                <span className="text-[10px] font-semibold bg-slate-500/10 text-slate-400 px-2 py-0.5 rounded-full border border-slate-500/20 uppercase">
                  Đang kết nối...
                </span>
              )}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
              <span>NẤM RƠM CP</span>
              <span aria-hidden="true" className="inline-block h-1 w-1 rounded-full bg-muted-foreground/50" />
              <span>Nhà trụ Alpha (35 trụ)</span>
            </p>
          </div>

          {/* Right: Hardware Status + Actions */}
          <div className="flex items-center gap-2">
            {/* Hardware telemetry widget (device status indicator) */}
            <div className="hidden md:block">
              <HardwareTelemetryWidget />
            </div>

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
                    <h3 className="font-semibold text-foreground text-sm">Chẩn đoán hệ thống</h3>
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
                      Xóa nhật ký
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
                    <p className="text-xs text-muted-foreground">Quản lý cơ sở</p>
                  </div>
                  <div className="py-2">
                    <button className="w-full px-4 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors flex items-center gap-2 text-left">
                      <User size={16} />
                      Hồ sơ người dùng
                    </button>
                    <button className="w-full px-4 py-2 text-sm text-foreground hover:bg-muted/50 transition-colors flex items-center gap-2 text-left">
                      <Settings2 size={16} />
                      Cài đặt cơ sở
                    </button>
                  </div>
                  <div className="border-t border-border p-2">
                    <button className="w-full px-4 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors flex items-center gap-2 text-left">
                      <LogOut size={16} />
                      Ngắt kết nối
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
