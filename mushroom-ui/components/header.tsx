'use client'

import { Button } from '@/components/ui/button'
import { HardwareTelemetryWidget } from '@/components/hardware-telemetry-widget'
import { useRealTelemetry } from '@/lib/real-telemetry-context'
import { cn } from '@/lib/utils'
import { AlertTriangle, Bell, ChevronDown, LogOut, Settings2, ShieldAlert, User, WifiOff, X } from 'lucide-react'
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
  } = useRealTelemetry()

  const showDeviceOfflineAlert = deviceStatus === 'offline' && !deviceAlertDismissed
  const showDeviceStaleAlert = deviceStatus === 'stale' && !deviceAlertDismissed

  const alerts: Array<{
    id: string
    type: 'critical' | 'warning'
    title: string
    message: string
  }> = []

  if (humidityCurrent !== null) {
    if (humidityCurrent < 60) {
      alerts.push({
        id: 'hum-crit-low',
        type: 'critical',
        title: 'Nguy hiểm: Độ ẩm thấp',
        message: `Độ ẩm hiện tại ${humidityCurrent.toFixed(1)}% (mức phù hợp: 70-90%). Nguy cơ nhiễm tạp cao.`,
      })
    } else if (humidityCurrent < 70) {
      alerts.push({
        id: 'hum-warn-low',
        type: 'warning',
        title: 'Cảnh báo độ ẩm thấp',
        message: `Độ ẩm hiện tại ${humidityCurrent.toFixed(1)}%. Nguy cơ khô bề mặt và không khí.`,
      })
    } else if (humidityCurrent > 95) {
      alerts.push({
        id: 'hum-crit-high',
        type: 'critical',
        title: 'Cảnh báo: Độ ẩm quá cao',
        message: `Độ ẩm hiện tại ${humidityCurrent.toFixed(1)}%. Nấm có thể dễ bị bệnh.`,
      })
    } else if (humidityCurrent > 90) {
      alerts.push({
        id: 'hum-warn-high',
        type: 'warning',
        title: 'Cảnh báo độ ẩm cao',
        message: `Độ ẩm hiện tại ${humidityCurrent.toFixed(1)}%. Cần theo dõi để tránh nấm bị ẩm quá mức.`,
      })
    }
  }

  if (temperatureCurrent !== null) {
    if (temperatureCurrent < 20) {
      alerts.push({
        id: 'temp-crit-frost',
        type: 'critical',
        title: 'CẢNH BÁO: NHIỆT ĐỘ QUÁ THẤP',
        message: `Nhiệt độ không khí ${temperatureCurrent.toFixed(1)}°C. Nấm có thể ngừng phát triển.`,
      })
    } else if (temperatureCurrent < 28) {
      alerts.push({
        id: 'temp-warn-low',
        type: 'warning',
        title: 'Nhiệt độ không khí thấp',
        message: `Nhiệt độ không khí ${temperatureCurrent.toFixed(1)}°C. Nấm sẽ phát triển chậm hơn.`,
      })
    } else if (temperatureCurrent > 38) {
      alerts.push({
        id: 'temp-crit-high',
        type: 'critical',
        title: 'Nguy hiểm: Nhiệt quá cao',
        message: `Nhiệt độ không khí ${temperatureCurrent.toFixed(1)}°C. Nấm có thể bị ảnh hưởng xấu.`,
      })
    } else if (temperatureCurrent > 35) {
      alerts.push({
        id: 'temp-warn-high',
        type: 'warning',
        title: 'Cảnh báo nhiệt cao',
        message: `Nhiệt độ không khí ${temperatureCurrent.toFixed(1)}°C. Có nguy cơ sốc nhiệt.`,
      })
    }
  }

  if (co2Current !== null) {
    if (co2Current > 1500) {
      alerts.push({
        id: 'co2-crit-high',
        type: 'critical',
        title: 'Cảnh báo CO2 cao',
        message: `Khí CO₂ hiện tại ${Math.round(co2Current)} ppm. Nấm có thể bị dài thân hoặc biến dạng.`,
      })
    } else if (co2Current > 1200) {
      alerts.push({
        id: 'co2-warn-high',
        type: 'warning',
        title: 'Cần tăng thông gió',
        message: `Khí CO₂ hiện tại ${Math.round(co2Current)} ppm. Mức phù hợp: 800-1200 ppm.`,
      })
    }
  }

  const notifications = [
    { id: 1, message: 'Đang hiển thị dữ liệu mới nhất từ phòng nấm', time: 'Vừa xong' },
    { id: 2, message: 'Hệ thống đang tự động điều chỉnh các thiết bị trong phòng nấm', time: '1 giờ trước' },
  ]

  const getAlertBg = (type: string) =>
    type === 'critical'
      ? 'bg-red-950/40 border-red-500/30'
      : 'bg-yellow-950/30 border-yellow-900/30'

  const getAlertTitleColor = (type: string) =>
    type === 'critical' ? 'text-red-300 font-bold' : 'text-yellow-300 font-semibold'

  const getAlertMsgColor = (type: string) =>
    type === 'critical' ? 'text-red-200/90' : 'text-yellow-200/80'

  return (
    <>
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
              Thiết bị tại nhà nấm (
              <code className="bg-red-900/40 px-1 rounded text-red-300">{monitoredDeviceId}</code>
              ) đã mất tín hiệu. Vui lòng kiểm tra nguồn điện và kết nối mạng tại nhà nấm.
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

      {showDeviceStaleAlert && (
        <div
          className="sticky top-0 z-40 border-b border-amber-500/50"
          style={{ background: 'linear-gradient(90deg, #1a1505 0%, #2d2008 50%, #1a1505 100%)' }}
        >
          <div className="flex items-center gap-3 px-4 py-2.5">
            <div className="flex items-center gap-2 flex-shrink-0">
              <AlertTriangle className="w-5 h-5" style={{ color: '#F59E0B' }} />
              <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#F59E0B' }}>
                ⚠ Dữ liệu chưa cập nhật
              </span>
            </div>
            <div className="flex-1 text-xs text-amber-200/80">
              Thiết bị tại nhà nấm (<code className="bg-amber-900/40 px-1 rounded text-amber-300">{monitoredDeviceId}</code>) vẫn kết nối nhưng chưa gửi dữ liệu mới. Vui lòng kiểm tra thiết bị hoặc cảm biến.
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeviceAlertDismissed(true)}
              className="flex-shrink-0 w-7 h-7 p-0 text-amber-400 hover:text-white hover:bg-amber-900/40"
            >
              <X size={14} />
            </Button>
          </div>
        </div>
      )}

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
                    getAlertBg(alert.type),
                  )}
                >
                  <div className="flex-1 text-xs">
                    <p className={getAlertTitleColor(alert.type)}>{alert.title}</p>
                    <p className={cn('line-clamp-1 mt-0.5', getAlertMsgColor(alert.type))}>
                      {alert.message}
                    </p>
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

      <header className="sticky top-0 z-20 bg-card/40 border-b border-border backdrop-blur-xl">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground tracking-tight flex items-center gap-2">
              Nhà nấm rơm Beta
              {deviceStatus === 'offline' ? (
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase animate-pulse"
                  style={{
                    background: 'rgba(220,20,60,0.12)',
                    color: '#DC143C',
                    borderColor: 'rgba(220,20,60,0.35)',
                  }}
                >
                  Mất kết nối
                </span>
              ) : deviceStatus === 'stale' ? (
                <span className="text-[10px] font-semibold bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/20 uppercase">
                  Dữ liệu chưa cập nhật
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
              <span>TRANG TRẠI NẤM RƠM</span>
              <span aria-hidden="true" className="inline-block h-1 w-1 rounded-full bg-muted-foreground/50" />
              <span>Khu trồng số 1 (35 trụ)</span>
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden md:block">
              <HardwareTelemetryWidget />
            </div>

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

              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-50">
                  <div className="p-4 border-b border-border bg-card/50">
                    <h3 className="font-semibold text-foreground text-sm">Thông báo</h3>
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className="p-3 border-b border-border/50 hover:bg-slate-900/40 transition-colors"
                      >
                        <p className="text-xs text-foreground">{notif.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{notif.time}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setUserMenuOpen(!userMenuOpen)
                  setNotificationsOpen(false)
                }}
              >
                <User size={16} />
                <span className="hidden sm:inline text-xs">Người dùng</span>
                <ChevronDown size={14} />
              </Button>

              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-card border border-border rounded-lg shadow-lg overflow-hidden z-50">
                  <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-slate-900/40">
                    <Settings2 size={14} /> Cài đặt
                  </button>
                  <button className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:bg-slate-900/40">
                    <LogOut size={14} /> Đăng xuất
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
    </>
  )
}
