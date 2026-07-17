'use client'

import { Card } from '@/components/ui/card'
import { CloudFog, Wind, Zap, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react'
import { useRealTelemetry } from '@/lib/real-telemetry-context'
import { postActuatorOverride, postSetOperatingMode } from '@/lib/telemetry-api'
import { useState, useEffect } from 'react'

type EdgeState = boolean | null

interface ActuatorStatusRowProps {
  name: string
  description: string
  icon: React.ReactNode
  state: EdgeState
  mode: 'AI' | 'MANUAL' | null
  locked?: boolean
  lockReason?: string
  uninstalled?: boolean
  isPending?: boolean
  telemetryDetails?: React.ReactNode
  onAction: () => void
}

function ActuatorStatusRow({
  name,
  description,
  icon,
  state,
  mode,
  locked = false,
  lockReason,
  uninstalled = false,
  isPending = false,
  telemetryDetails,
  onAction,
}: ActuatorStatusRowProps) {
  const unavailable = state === null
  const source = locked ? 'safety' : mode === 'MANUAL' ? 'user' : mode === 'AI' ? 'ai' : 'unknown'
  const actionLabel = unavailable
    ? 'Chưa có dữ liệu'
    : state
      ? 'Tắt thiết bị'
      : 'Bật thiết bị'
  const actionDisabled = unavailable || uninstalled || locked || mode === null || isPending

  return (
    <div className={`p-4 rounded-lg border transition-all duration-300 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
      state === true ? 'border-emerald-500/50 bg-emerald-950/10' : locked ? 'border-red-500/40 bg-red-950/10' : 'border-slate-700/50 bg-slate-900/20'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded-lg shrink-0 ${state === true ? 'bg-emerald-500/20' : locked ? 'bg-red-950/30' : 'bg-slate-700/30'}`}>
          {icon}
        </div>
        <div>
          <h4 className="font-semibold text-foreground text-sm flex items-center gap-1.5 flex-wrap">
            {name}
            {uninstalled && <span className="text-[9px] font-bold uppercase bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">Chưa lắp</span>}
          </h4>
          <p className="text-xs mt-0.5 text-muted-foreground">{description}</p>
          <div className={`mt-1.5 flex items-center gap-1 text-[11px] font-medium ${
            source === 'safety' ? 'text-red-400' : source === 'user' ? 'text-amber-300' : source === 'ai' ? 'text-cyan-300' : 'text-slate-400'
          }`}>
            {source === 'safety' ? <ShieldAlert size={12} /> : <span className="text-sm leading-none">{source === 'user' ? '🔌' : source === 'ai' ? '●' : '○'}</span>}
            <span>{source === 'safety' ? 'Khóa an toàn' : source === 'user' ? 'Lệnh từ người dùng' : source === 'ai' ? 'Điều khiển bởi AI' : 'Chưa xác định nguồn điều khiển'}</span>
          </div>
          {locked && lockReason && (
            <div className="flex items-center gap-1 text-[11px] text-red-300 font-medium mt-1">
              <ShieldAlert size={12} /><span>Bảo vệ: {lockReason}. Thiết bị chưa thể bật lại.</span>
            </div>
          )}
          {telemetryDetails}
          {unavailable && !uninstalled && <p className="text-[11px] text-slate-500 mt-1">Chưa nhận được dữ liệu xác nhận từ ESP32</p>}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
        <div className={`min-w-20 text-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
          state === true ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : locked ? 'bg-red-500/20 text-red-300 border-red-500/25' : 'bg-slate-800 text-slate-400 border-slate-700'
        }`}>{unavailable ? '—' : state ? 'Đang chạy' : 'Đang tắt'}</div>
        <button
          disabled={actionDisabled}
          onClick={onAction}
          title={locked ? lockReason : actionLabel}
          className="min-w-28 rounded-md bg-slate-800 px-3 py-2 text-[11px] font-bold text-slate-200 transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >{isPending ? 'Đang gửi...' : locked ? 'Khóa an toàn' : actionLabel}</button>
      </div>
    </div>
  )
}

interface StandardActuatorsControlProps {
  fanActive?: EdgeState
  lampStageActive?: EdgeState
  lampStage2Active?: EdgeState
  heaterWaterActive?: EdgeState
  mistActive?: EdgeState
  blackoutActive?: EdgeState
  readOnly?: boolean
}

export function StandardActuatorsControl({
  fanActive = null,
  lampStageActive = null,
  lampStage2Active = null,
  heaterWaterActive = null,
  mistActive = null,
  blackoutActive = null,
}: StandardActuatorsControlProps) {
  const { monitoredDeviceId, humidityCurrent, temperatureCurrent, operatingMode, snapshot, mistAck, fanAck, lampAck, deviceStatus, lastTelemetryAt } = useRealTelemetry()
  const cropDayInt = snapshot?.cropDayInt ?? 0
  const [showManualConfirm, setShowManualConfirm] = useState(false)
  const [modePending, setModePending] = useState(false)
  const [actionPending, setActionPending] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const setOperatingMode = async (mode: 'AI' | 'MANUAL') => {
    if (!monitoredDeviceId) {
      setToast({ message: 'Chưa chọn thiết bị để thay đổi chế độ.', type: 'error' })
      return
    }
    setModePending(true)
    const result = await postSetOperatingMode(monitoredDeviceId, mode)
    setModePending(false)
    if (result.success) {
      setShowManualConfirm(false)
      setToast({ message: mode === 'MANUAL' ? 'Đã gửi lệnh tắt AI. Các relay sẽ dừng trước khi điều khiển thủ công.' : 'Đã gửi lệnh khôi phục điều khiển AI.', type: 'success' })
    } else {
      setToast({ message: result.message, type: 'error' })
    }
  }

  const applyAction = async (actuator: 'fan' | 'lamp' | 'mist', state: EdgeState) => {
    if (!monitoredDeviceId || state === null || operatingMode === null || controlsBlocked) return
    setActionPending(actuator)
    const result = await postActuatorOverride(monitoredDeviceId, actuator, !state)
    setActionPending(null)
    setToast({ message: result.success ? 'Đã gửi lệnh; chờ firmware xác nhận trạng thái relay.' : result.message, type: result.success ? 'success' : 'error' })
  }

  const startAll = async () => {
    if (!monitoredDeviceId || operatingMode === null || controlsBlocked) return
    setActionPending('all')
    const requests: Promise<{ success: boolean; message: string }>[] = []
    if (fanActive === false) requests.push(postActuatorOverride(monitoredDeviceId, 'fan', true))
    if (lampStageActive === false && cropDayInt <= 8) requests.push(postActuatorOverride(monitoredDeviceId, 'lamp', true))
    if (mistActive === false && blackoutActive !== true && humidityCurrent !== null && humidityCurrent < 90) requests.push(postActuatorOverride(monitoredDeviceId, 'mist', true))
    const results = await Promise.all(requests)
    setActionPending(null)
    setToast({ message: results.every((item) => item.success) ? 'Đã gửi lệnh khởi động thiết bị khả dụng.' : 'Một số thiết bị không thể khởi động do giới hạn an toàn.', type: results.every((item) => item.success) ? 'success' : 'error' })
  }

  const lampLockReason = cropDayInt > 8
    ? 'Đã khóa trong giai đoạn ra quả thể'
    : temperatureCurrent !== null && temperatureCurrent >= 35
      ? `Quá nhiệt (>${35}°C)`
      : undefined
  const mistLockReason = blackoutActive === true
    ? 'Tạm ngưng phun sương giờ trưa'
    : humidityCurrent !== null && humidityCurrent >= 90
      ? 'Độ ẩm vượt giới hạn an toàn (90%)'
      : undefined
  const lastTelemetryLabel = lastTelemetryAt
    ? new Date(lastTelemetryAt).toLocaleString('vi-VN')
    : 'Chưa nhận được'
  const controlsBlocked = deviceStatus === 'SENSOR_FAULT' || deviceStatus === 'OFFLINE' || deviceStatus === 'UNKNOWN'
  const deviceStatusLabel = deviceStatus === 'ONLINE_ACTIVE'
    ? 'Đang hoạt động'
    : deviceStatus === 'DEGRADED_LATENCY'
      ? 'Kết nối yếu'
      : deviceStatus === 'SENSOR_FAULT'
        ? 'Lỗi cảm biến'
        : deviceStatus === 'OFFLINE'
          ? 'Offline'
          : 'Chưa xác định'
  const deviceStatusColor = deviceStatus === 'ONLINE_ACTIVE'
    ? 'text-emerald-300'
    : deviceStatus === 'DEGRADED_LATENCY'
      ? 'text-amber-300'
      : deviceStatus === 'SENSOR_FAULT' || deviceStatus === 'OFFLINE'
        ? 'text-red-300'
        : 'text-slate-400'
  const relayTelemetryDetails = (relayId: string) => (
    <div className="mt-2 space-y-0.5 text-[11px] text-slate-400">
      <p>Telemetry cuối: <span className="text-slate-200">{lastTelemetryLabel}</span></p>
      <p>Relay nguồn: <span className="font-mono text-slate-200">{relayId}</span></p>
      <p>ESP32: <span className={`font-medium ${deviceStatusColor}`}>{deviceStatusLabel}</span></p>
    </div>
  )
  const fuzzyEnabled = operatingMode === 'AI'
  const isFuzzyOff = operatingMode === 'MANUAL'
  const manualAcks = [mistAck, fanAck, lampAck]
  const activeTimedAck = fuzzyEnabled
    ? manualAcks.find((ack) => ack !== null && ack.expires_ms !== null && ack.expires_ms > Date.now()) ?? null
    : null

  return (
    <Card className="p-6 border border-slate-700/50 bg-slate-950/40 relative">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold text-foreground text-lg">Thiết bị trong phòng nấm</h3>
          <p className="text-xs text-muted-foreground mt-1">Trạng thái vật lý và nguồn điều khiển có hiệu lực.</p>
        </div>
        <div className={`rounded-lg border px-3 py-2 text-xs ${isFuzzyOff ? 'border-amber-500/30 bg-amber-950/20' : 'border-cyan-500/30 bg-cyan-950/20'}`}>
          <div className="font-bold text-foreground">{isFuzzyOff ? '🔌 Fuzzy Logic: OFF' : '● Fuzzy Logic: ON'}</div>
          <div className="mt-0.5 text-muted-foreground">{isFuzzyOff ? 'Lệnh manual được giữ; Safety Protector vẫn có quyền ép bật/tắt, giới hạn 3 phút và cooldown.' : 'Fuzzy tạo output nền; lệnh manual đảo relay 30 giây rồi trả quyền cho Fuzzy. Safety Protector luôn có quyền chặn.'}</div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => void startAll()} disabled={actionPending !== null || operatingMode === null || controlsBlocked} className="rounded bg-amber-500/20 px-2 py-1 font-bold text-amber-200 disabled:opacity-40">{actionPending === 'all' ? 'Đang gửi...' : 'Khởi động tất cả'}</button>
            <button onClick={() => fuzzyEnabled ? setShowManualConfirm(true) : void setOperatingMode('AI')} disabled={modePending || controlsBlocked} className="rounded bg-slate-800 px-2 py-1 font-bold text-slate-200 disabled:opacity-40">{fuzzyEnabled ? 'Tắt Fuzzy' : 'Bật Fuzzy'}</button>
          </div>
        </div>
      </div>

      {activeTimedAck && (
        <p className="mb-3 rounded border border-cyan-500/30 bg-cyan-950/20 px-3 py-2 text-xs text-cyan-200">
          Manual override đang có hiệu lực trong 30 giây; sau đó relay trả quyền cho Fuzzy Logic.
        </p>
      )}

      <div className="space-y-3">
        <ActuatorStatusRow name="Quạt đối lưu" description="Giúp không khí lưu thông, hạ nhiệt và giảm CO₂" icon={<Wind className="w-5 h-5 text-cyan-400" />} state={fanActive} mode={operatingMode} isPending={actionPending === 'fan'} telemetryDetails={relayTelemetryDetails('relay_2')} onAction={() => void applyAction('fan', fanActive)} />
        <ActuatorStatusRow name="Đèn nhiệt sưởi ấm (HLamp)" description="Tự động sưởi khi phòng nấm cần tăng nhiệt" icon={<Zap className="w-5 h-5 text-amber-400" />} state={lampStageActive} mode={operatingMode} locked={Boolean(lampLockReason)} lockReason={lampLockReason} isPending={actionPending === 'lamp'} telemetryDetails={relayTelemetryDetails('relay_4')} onAction={() => void applyAction('lamp', lampStageActive)} />
        <ActuatorStatusRow name="Máy tạo ẩm siêu âm" description="Tự động phun sương theo độ ẩm" icon={<CloudFog className="w-5 h-5 text-teal-400" />} state={mistActive} mode={operatingMode} locked={Boolean(mistLockReason)} lockReason={mistLockReason} isPending={actionPending === 'mist'} telemetryDetails={relayTelemetryDetails('relay_1')} onAction={() => void applyAction('mist', mistActive)} />
      </div>

      {showManualConfirm && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-slate-950/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-amber-500/30 bg-slate-900 p-5 shadow-xl">
            <h4 className="font-semibold text-foreground">Tắt Fuzzy Logic?</h4>
            <p className="mt-2 text-sm text-slate-400">Fuzzy sẽ dừng tạo output nền. Relay giữ trạng thái hiện tại; lệnh manual sẽ được giữ cho đến lệnh mới. Safety Protector vẫn luôn có quyền ép bật/tắt để bảo vệ thiết bị và nấm.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowManualConfirm(false)} className="rounded border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300">Quay lại</button>
              <button onClick={() => void setOperatingMode('MANUAL')} disabled={modePending || controlsBlocked} className="rounded bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40">{modePending ? 'Đang chuyển...' : 'Xác nhận tắt Fuzzy'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-md ${toast.type === 'success' ? 'bg-gradient-to-r from-emerald-900/80 to-teal-900/80 border-emerald-500/30 text-emerald-200' : 'bg-gradient-to-r from-red-950/80 to-pink-950/80 border-red-500/30 text-red-200'}`}>
        {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" /> : <XCircle className="w-5 h-5 text-red-400 shrink-0" />}<span className="text-xs font-medium">{toast.message}</span>
      </div>}
    </Card>
  )
}
