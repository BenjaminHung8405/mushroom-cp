'use client'

import { Card } from '@/components/ui/card'
import { ChevronDown, CloudFog, Wind, Zap, ShieldAlert, CheckCircle2, Circle, Cpu, UserRound, XCircle } from 'lucide-react'
import { useRealTelemetry } from '@/lib/real-telemetry-context'
import { postActuatorOverride, postSetOperatingMode } from '@/lib/telemetry-api'
import { useBatch } from '@/lib/batch-context'
import { isMistingAllowed, mistingLockReason } from '@/app/lib/operational-safety'
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
  const actionDisabled = unavailable || locked || mode === null || isPending
  const stateLabel = unavailable ? 'Chưa xác nhận' : state ? 'Đang chạy' : 'Đang tắt'
  const stateStyle = locked
    ? 'border-red-500/35 bg-red-950/30 text-red-200'
    : state === true
      ? 'border-emerald-500/35 bg-emerald-950/25 text-emerald-200'
      : 'border-slate-700 bg-slate-900/70 text-slate-400'

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 transition-colors duration-200 hover:border-slate-700">
      <div className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center md:grid-cols-[minmax(190px,1.45fr)_112px_minmax(150px,1fr)_128px] md:gap-4 md:px-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`mt-0.5 rounded-lg p-2 ${locked ? 'bg-red-950/30' : state ? 'bg-emerald-950/30' : 'bg-slate-900'}`}>{icon}</div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-foreground">{name}</h4>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
          </div>
        </div>
        <span className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${stateStyle}`}>{stateLabel}</span>
        <div className={`flex min-w-0 items-center gap-1.5 text-[11px] font-medium ${source === 'safety' ? 'text-red-300' : source === 'user' ? 'text-amber-300' : source === 'ai' ? 'text-cyan-300' : 'text-slate-400'}`}>
          {source === 'safety' ? <ShieldAlert size={13} /> : source === 'user' ? <UserRound size={13} /> : source === 'ai' ? <Cpu size={13} /> : <Circle size={10} />}
          <span>{source === 'safety' ? 'Khóa an toàn' : source === 'user' ? 'Thủ công' : source === 'ai' ? 'Fuzzy AI' : 'Chưa xác định'}</span>
        </div>
        <button disabled={actionDisabled} onClick={onAction} title={locked ? lockReason : actionLabel} className="min-h-11 w-full cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-100 transition-colors duration-200 hover:border-slate-600 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-40 md:w-auto">
          {isPending ? 'Đang gửi…' : locked ? 'Đang khóa' : actionLabel}
        </button>
      </div>
      <details className="group border-t border-slate-800">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 text-xs text-slate-400 transition-colors duration-200 hover:bg-slate-900/60 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 md:px-4">
          <span>{locked && lockReason ? `Bảo vệ: ${lockReason}` : unavailable ? 'Chưa nhận được xác nhận relay từ ESP32' : 'Chi tiết relay và telemetry'}</span>
          <ChevronDown className="size-4 shrink-0 transition-transform duration-200 group-open:rotate-180" />
        </summary>
        <div className="border-t border-slate-800 bg-slate-950/65 px-3 py-2.5 md:px-4">
          {locked && lockReason && <p className="mb-2 text-xs text-red-200">Thiết bị không thể bật lại cho đến khi điều kiện bảo vệ được gỡ.</p>}
          {telemetryDetails}
        </div>
      </details>
    </div>
  )
}

interface PendingRelayAction {
  actuator: 'fan' | 'lamp' | 'mist'
  target: boolean
}

export function StandardActuatorsControl() {
  // Read the source of truth directly. Passing relay values through the page
  // creates an unnecessary render hop and made this control easy to wire to a
  // stale source in other dashboard layouts.
  const {
    monitoredDeviceId,
    humidityCurrent,
    temperatureCurrent,
    operatingMode,
    snapshot,
    mistAck,
    fanAck,
    lampAck,
    deviceStatus,
    lastTelemetryAt,
    fanActive,
    lampStageActive,
    mistActive,
    middayBlackoutActive: blackoutActive,
    refreshTelemetry,
  } = useRealTelemetry()
  const { spawnRunningEndDay } = useBatch()
  const cropDayInt = snapshot?.cropDayInt ?? 0
  const [now, setNow] = useState(() => new Date())
  const [showManualConfirm, setShowManualConfirm] = useState(false)
  const [modePending, setModePending] = useState<'AI' | 'MANUAL' | null>(null)
  const [actionPending, setActionPending] = useState<PendingRelayAction | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const pendingRelayHasApplied = actionPending !== null && (
    (actionPending.actuator === 'fan' && fanActive === actionPending.target) ||
    (actionPending.actuator === 'lamp' && lampStageActive === actionPending.target) ||
    (actionPending.actuator === 'mist' && mistActive === actionPending.target)
  )

  // SSE remains the preferred confirmation channel. This short, scoped polling
  // loop makes command feedback resilient to deployments that buffer an SSE
  // event, without requiring the user to reload the entire dashboard.
  useEffect(() => {
    if (!actionPending) return
    if (pendingRelayHasApplied) {
      setActionPending(null)
      return
    }

    const poll = window.setInterval(() => void refreshTelemetry(), 1_500)
    const timeout = window.setTimeout(() => {
      setActionPending(null)
      setToast({ message: 'Thiết bị chưa xác nhận trạng thái relay. Hãy kiểm tra kết nối ESP32.', type: 'error' })
    }, 15_000)
    return () => {
      window.clearInterval(poll)
      window.clearTimeout(timeout)
    }
  }, [actionPending, pendingRelayHasApplied, refreshTelemetry])

  useEffect(() => {
    if (!modePending) return
    if (operatingMode === modePending) {
      setModePending(null)
      return
    }

    const poll = window.setInterval(() => void refreshTelemetry(), 1_500)
    const timeout = window.setTimeout(() => {
      setModePending(null)
      setToast({ message: 'Thiết bị chưa xác nhận chế độ vận hành mới.', type: 'error' })
    }, 15_000)
    return () => {
      window.clearInterval(poll)
      window.clearTimeout(timeout)
    }
  }, [modePending, operatingMode, refreshTelemetry])

  const setOperatingMode = async (mode: 'AI' | 'MANUAL') => {
    if (!monitoredDeviceId) {
      setToast({ message: 'Chưa chọn thiết bị để thay đổi chế độ.', type: 'error' })
      return
    }
    setModePending(mode)
    const result = await postSetOperatingMode(monitoredDeviceId, mode)
    if (result.success) {
      setShowManualConfirm(false)
      await refreshTelemetry()
      setToast({ message: mode === 'MANUAL' ? 'Đã gửi lệnh tắt AI. Các relay sẽ dừng trước khi điều khiển thủ công.' : 'Đã gửi lệnh khôi phục điều khiển AI.', type: 'success' })
    } else {
      setModePending(null)
      setToast({ message: result.message, type: 'error' })
    }
  }

  const applyAction = async (actuator: 'fan' | 'lamp' | 'mist', state: EdgeState) => {
    if (!monitoredDeviceId || state === null || operatingMode === null || controlsBlocked) return
    if (actuator === 'mist' && (blackoutActive === true || !isMistingAllowed(now) || humidityCurrent !== null && humidityCurrent >= 90)) {
      setToast({
        message: blackoutActive === true
          ? 'ESP32 đang khóa Mist/HWat theo cửa sổ bảo vệ sinh học.'
          : !isMistingAllowed(now)
            ? mistingLockReason(now)
            : 'Không thể bật phun sương khi độ ẩm đã từ 90% trở lên.',
        type: 'error',
      })
      return
    }
    if (actuator === 'lamp' && (cropDayInt > spawnRunningEndDay || temperatureCurrent !== null && temperatureCurrent >= 35)) {
      setToast({
        message: cropDayInt > spawnRunningEndDay
          ? 'Đèn nhiệt đã bị khóa trong giai đoạn ra quả thể.'
          : 'Không thể bật đèn nhiệt khi nhiệt độ đã từ 35°C trở lên.',
        type: 'error',
      })
      return
    }
    const target = !state
    setActionPending({ actuator, target })
    const result = await postActuatorOverride(monitoredDeviceId, actuator, target)
    if (!result.success) {
      setActionPending(null)
      setToast({ message: result.message, type: 'error' })
      return
    }

    await refreshTelemetry()
    setToast({ message: 'Đã gửi lệnh; đang chờ ESP32 xác nhận trạng thái relay.', type: 'success' })
  }

  const startAll = async () => {
    if (!monitoredDeviceId || operatingMode === null || controlsBlocked) return
    setActionPending({ actuator: 'fan', target: true })
    const requests: Promise<{ success: boolean; message: string }>[] = []
    if (fanActive === false) requests.push(postActuatorOverride(monitoredDeviceId, 'fan', true))
    if (lampStageActive === false && cropDayInt <= spawnRunningEndDay) requests.push(postActuatorOverride(monitoredDeviceId, 'lamp', true))
    if (mistActive === false && !mistControlsLocked && humidityCurrent !== null && humidityCurrent < 90) requests.push(postActuatorOverride(monitoredDeviceId, 'mist', true))
    const results = await Promise.all(requests)
    await refreshTelemetry()
    setActionPending(null)
    setToast({ message: results.every((item) => item.success) ? 'Đã gửi lệnh khởi động thiết bị khả dụng.' : 'Một số thiết bị không thể khởi động do giới hạn an toàn.', type: results.every((item) => item.success) ? 'success' : 'error' })
  }

  const lampLockReason = cropDayInt > spawnRunningEndDay
    ? 'Đã khóa trong giai đoạn ra quả thể'
    : temperatureCurrent !== null && temperatureCurrent >= 35
      ? `Quá nhiệt (>${35}°C)`
      : undefined
  const clientMistingLockReason = !isMistingAllowed(now) ? mistingLockReason(now) : undefined
  const mistLockReason = blackoutActive === true
    ? 'ESP32 đang khóa Mist/HWat theo cửa sổ bảo vệ'
    : clientMistingLockReason
      ? clientMistingLockReason
      : humidityCurrent !== null && humidityCurrent >= 90
        ? 'Độ ẩm vượt giới hạn an toàn (90%)'
        : undefined
  const mistControlsLocked = Boolean(mistLockReason)
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
    <Card className="relative border border-slate-800 bg-slate-950/50 p-4 md:p-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-foreground">Điều khiển thiết bị</h3>
          <p className="mt-1 text-xs text-muted-foreground">Trạng thái vật lý, nguồn lệnh hiệu lực và khóa an toàn.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold ${isFuzzyOff ? 'border-amber-500/30 bg-amber-950/20 text-amber-200' : 'border-cyan-500/30 bg-cyan-950/20 text-cyan-200'}`}>
            {isFuzzyOff ? <UserRound className="size-3.5" /> : <Cpu className="size-3.5" />}{isFuzzyOff ? 'Fuzzy: Thủ công' : 'Fuzzy: Tự động'}
          </div>
          <button onClick={() => void startAll()} disabled={actionPending !== null || operatingMode === null || controlsBlocked} className="min-h-11 cursor-pointer rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 text-xs font-semibold text-amber-100 transition-colors duration-200 hover:bg-amber-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-40">{actionPending ? 'Đang gửi…' : 'Khởi động khả dụng'}</button>
          <button onClick={() => fuzzyEnabled ? setShowManualConfirm(true) : void setOperatingMode('AI')} disabled={modePending !== null || controlsBlocked} className="min-h-11 cursor-pointer rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-slate-100 transition-colors duration-200 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:cursor-not-allowed disabled:opacity-40">{modePending ? 'Đang chuyển…' : fuzzyEnabled ? 'Chuyển thủ công' : 'Bật Fuzzy'}</button>
          </div>
        </div>

      {activeTimedAck && (
        <p className="mb-3 rounded border border-cyan-500/30 bg-cyan-950/20 px-3 py-2 text-xs text-cyan-200">
          Manual override đang có hiệu lực trong 30 giây; sau đó relay trả quyền cho Fuzzy Logic.
        </p>
      )}

      <div className="space-y-2">
        <ActuatorStatusRow name="Quạt đối lưu" description="Giúp không khí lưu thông, hạ nhiệt và giảm CO₂" icon={<Wind className="w-5 h-5 text-cyan-400" />} state={fanActive} mode={operatingMode} isPending={actionPending?.actuator === 'fan'} telemetryDetails={relayTelemetryDetails('relay_2')} onAction={() => void applyAction('fan', fanActive)} />
        <ActuatorStatusRow name="Đèn nhiệt sưởi ấm (HLamp)" description="Tự động sưởi khi phòng nấm cần tăng nhiệt" icon={<Zap className="w-5 h-5 text-amber-400" />} state={lampStageActive} mode={operatingMode} locked={Boolean(lampLockReason)} lockReason={lampLockReason} isPending={actionPending?.actuator === 'lamp'} telemetryDetails={relayTelemetryDetails('relay_4')} onAction={() => void applyAction('lamp', lampStageActive)} />
        <ActuatorStatusRow name="Máy tạo ẩm siêu âm" description="Tự động phun sương theo độ ẩm" icon={<CloudFog className="w-5 h-5 text-teal-400" />} state={mistActive} mode={operatingMode} locked={mistControlsLocked} lockReason={mistLockReason} isPending={actionPending?.actuator === 'mist'} telemetryDetails={relayTelemetryDetails('relay_1')} onAction={() => void applyAction('mist', mistActive)} />
      </div>

      {showManualConfirm && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-slate-950/85 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-amber-500/30 bg-slate-900 p-5 shadow-xl">
            <h4 className="font-semibold text-foreground">Tắt Fuzzy Logic?</h4>
            <p className="mt-2 text-sm text-slate-400">Fuzzy sẽ dừng tạo output nền. Relay giữ trạng thái hiện tại; lệnh manual sẽ được giữ cho đến lệnh mới. Safety Protector vẫn luôn có quyền ép bật/tắt để bảo vệ thiết bị và nấm.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setShowManualConfirm(false)} className="min-h-11 cursor-pointer rounded border border-slate-700 px-3 py-2 text-xs font-bold text-slate-300 transition-colors duration-200 hover:bg-slate-800">Quay lại</button>
              <button onClick={() => void setOperatingMode('MANUAL')} disabled={modePending !== null || controlsBlocked} className="min-h-11 cursor-pointer rounded bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950 transition-colors duration-200 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40">{modePending ? 'Đang chuyển...' : 'Xác nhận tắt Fuzzy'}</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`fixed bottom-24 right-4 z-50 flex max-w-sm items-center gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-md md:bottom-6 md:right-6 ${toast.type === 'success' ? 'border-emerald-500/30 bg-emerald-950/95 text-emerald-100' : 'border-red-500/30 bg-red-950/95 text-red-100'}`}>
        {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" /> : <XCircle className="w-5 h-5 text-red-400 shrink-0" />}<span className="text-xs font-medium">{toast.message}</span>
      </div>}
    </Card>
  )
}
