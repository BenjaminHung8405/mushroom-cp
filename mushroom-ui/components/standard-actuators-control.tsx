'use client'

import { Card } from '@/components/ui/card'
import { CloudFog, Wind, Zap, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react'
import { useRealTelemetry } from '@/lib/real-telemetry-context'
import { useBatch } from '@/lib/batch-context'
import { postActuatorOverride } from '@/lib/telemetry-api'
import { useState, useEffect } from 'react'

type EdgeState = boolean | null

interface ActuatorStatusRowProps {
  name: string
  description: string
  icon: React.ReactNode
  state: EdgeState
  locked?: boolean
  lockReason?: string
  overrideMode: 'auto' | 'on' | 'off'
  onOverrideChange: (mode: 'auto' | 'on' | 'off') => void
  uninstalled?: boolean
}

function ActuatorStatusRow({
  name,
  description,
  icon,
  state,
  locked = false,
  lockReason,
  overrideMode,
  onOverrideChange,
  uninstalled = false,
}: ActuatorStatusRowProps) {
  const unavailable = state === null

  return (
    <div
      className={`p-4 rounded-lg border transition-all duration-300 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
        state === true
          ? 'border-emerald-500/50 bg-emerald-950/10'
          : locked
          ? 'border-red-950/40 bg-red-950/5 opacity-80'
          : 'border-slate-700/50 bg-slate-900/20'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`p-2 rounded-lg shrink-0 ${
            state === true ? 'bg-emerald-500/20' : locked ? 'bg-red-950/30' : 'bg-slate-700/30'
          }`}
        >
          {icon}
        </div>
        <div>
          <h4 className="font-semibold text-foreground text-sm flex items-center gap-1.5 flex-wrap">
            {name}
            {locked && (
              <span className="text-[9px] font-bold uppercase bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded border border-red-500/20">
                Khóa cứng
              </span>
            )}
            {uninstalled && (
              <span className="text-[9px] font-bold uppercase bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">
                Chưa lắp
              </span>
            )}
          </h4>
          <p className="text-xs mt-0.5 text-muted-foreground">{description}</p>
          {locked && lockReason && (
            <div className="flex items-center gap-1 text-[11px] text-red-400 font-medium mt-1">
              <ShieldAlert size={12} />
              <span>{lockReason}</span>
            </div>
          )}
          {unavailable && !uninstalled && (
            <p className="text-[11px] text-slate-500 mt-1">Chưa nhận được dữ liệu</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
        {/* Physical Status Indicator */}
        <div
          className={`min-w-16 text-center px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${
            state === true
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
              : 'bg-slate-800 text-slate-400 border-slate-700'
          }`}
        >
          {unavailable ? '—' : state ? 'Đang chạy' : 'Đã tắt'}
        </div>

        {/* Override Control Button Group */}
        <div className="flex rounded-lg border border-slate-800 bg-slate-950/60 p-0.5 items-center">
          <button
            disabled={uninstalled}
            onClick={() => onOverrideChange('auto')}
            className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all duration-200 ${
              overrideMode === 'auto'
                ? 'bg-slate-800 text-slate-200 shadow-sm'
                : 'text-slate-500 hover:text-slate-300 disabled:opacity-40'
            }`}
            title="Chạy tự động theo điều khiển Logic mờ"
          >
            Tự động
          </button>
          <button
            disabled={uninstalled || locked}
            onClick={() => onOverrideChange('on')}
            className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all duration-200 ${
              overrideMode === 'on'
                ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/30'
                : 'text-slate-500 hover:text-emerald-400/80 disabled:opacity-30 disabled:hover:text-slate-500'
            }`}
            title="Ép Bật thủ công (Có giám sát giới hạn an toàn)"
          >
            Bật
          </button>
          <button
            disabled={uninstalled}
            onClick={() => onOverrideChange('off')}
            className={`px-2.5 py-1 text-[10px] font-bold rounded-md transition-all duration-200 ${
              overrideMode === 'off'
                ? 'bg-red-500/20 text-red-300 border border-red-500/25'
                : 'text-slate-500 hover:text-red-400/80 disabled:opacity-30'
            }`}
            title="Ép Tắt thủ công"
          >
            Tắt
          </button>
        </div>
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
  const { monitoredDeviceId, humidityCurrent, temperatureCurrent, mistAck, fanAck, lampAck } = useRealTelemetry()
  const { cropDayInt } = useBatch()

  const [mistMode, setMistMode] = useState<'auto' | 'on' | 'off'>('auto')
  const [fanMode, setFanMode] = useState<'auto' | 'on' | 'off'>('auto')
  const [lampMode, setLampMode] = useState<'auto' | 'on' | 'off'>('auto')

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Automatically dismiss toast after 3.5 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500)
      return () => clearTimeout(timer)
    }
  }, [toast])

  // S4-D2: Reconcile optimistic UI state from firmware-authoritative ack.
  // When the firmware ack arrives, replace local optimistic state with the
  // authoritative effective_intent so UI always reflects real device state.
  useEffect(() => {
    if (mistAck?.effective_intent) {
      setMistMode(mistAck.effective_intent)
    }
  }, [mistAck?.effective_intent])

  useEffect(() => {
    if (fanAck?.effective_intent) {
      setFanMode(fanAck.effective_intent)
    }
  }, [fanAck?.effective_intent])

  useEffect(() => {
    if (lampAck?.effective_intent) {
      setLampMode(lampAck.effective_intent)
    }
  }, [lampAck?.effective_intent])

  // S4-D3: When Core 1 releases the override (safety gate), return to AUTO and
  // display the exact firmware-provided reason — never derive it client-side.
  useEffect(() => {
    if (lampAck?.release_reason) {
      setLampMode('auto')
      setToast({
        message: `[Firmware] Đèn nhiệt đã được nhả bởi firmware: ${lampAck.release_reason}`,
        type: 'error',
      })
    }
  }, [lampAck?.release_reason])

  useEffect(() => {
    if (mistAck?.release_reason) {
      setMistMode('auto')
      setToast({
        message: `[Firmware] Máy tạo ẩm đã được nhả bởi firmware: ${mistAck.release_reason}`,
        type: 'error',
      })
    }
  }, [mistAck?.release_reason])

  // S4-D4: UI pre-checks as UX-only first defense (device-side RTC/profile remains authoritative).
  // These reduce failed network round-trips but are NOT the safety enforcement layer.
  useEffect(() => {
    if (mistMode === 'on' && mistActive === false && humidityCurrent !== null && humidityCurrent >= 90) {
      setMistMode('auto')
      setToast({
        message: 'Máy tạo ẩm đã tự động nhả về Tự động (Auto) do độ ẩm chạm giới hạn nguy hiểm (90%).',
        type: 'error',
      })
    }
    if (
      lampMode === 'on' &&
      lampStageActive === false &&
      temperatureCurrent !== null &&
      temperatureCurrent >= (cropDayInt > 8 ? 30 : 35)
    ) {
      setLampMode('auto')
      setToast({
        message: `Thiết bị sưởi đã tự động nhả về Tự động (Auto) do nhiệt độ chạm giới hạn nguy hiểm (${
          cropDayInt > 8 ? 30 : 35
        }°C).`,
        type: 'error',
      })
    }
  }, [mistActive, lampStageActive, humidityCurrent, temperatureCurrent, cropDayInt])

  const handleOverrideChange = async (
    actuator: 'fan' | 'heater_air' | 'lamp' | 'lamp_stage' | 'mist',
    mode: 'auto' | 'on' | 'off',
  ) => {
    // 1. Biological rule checks on UI (UX-only first defense — S4-D4)
    if (actuator === 'mist' && mode === 'on') {
      const now = new Date()
      const hour = now.getHours()
      const minute = now.getMinutes()
      const mins = hour * 60 + minute
      const startBlackout = 11 * 60 // 11:00
      const endBlackout = 13 * 60 + 30 // 13:30

      if (mins >= startBlackout && mins <= endBlackout) {
        setToast({
          message: 'Không thể bật máy tạo ẩm thủ công trong khung giờ bảo vệ sốc nhiệt (11:00 - 13:30).',
          type: 'error',
        })
        return
      }
    }

    if ((actuator === 'heater_air' || actuator === 'lamp' || actuator === 'lamp_stage') && mode === 'on') {
      if (cropDayInt > 8) {
        setToast({
          message: `Thiết bị sưởi không được bật thủ công trong giai đoạn ra quả thể (ngày vụ nuôi: ${cropDayInt} > 8).`,
          type: 'error',
        })
        return
      }
    }

    // 2. Dispatch to backend; firmware will ack with effective_intent (S4-D2)
    const targetState = mode === 'on' ? true : mode === 'off' ? false : null
    const res = await postActuatorOverride(monitoredDeviceId, actuator, targetState)

    if (res.success) {
      // Apply optimistic state — will be reconciled when lampAck/mistAck/fanAck arrives
      if (actuator === 'mist') setMistMode(mode)
      if (actuator === 'fan') setFanMode(mode)
      if (actuator === 'heater_air' || actuator === 'lamp' || actuator === 'lamp_stage') setLampMode(mode)

      const displayName =
        actuator === 'mist'
          ? 'Máy tạo ẩm siêu âm'
          : actuator === 'fan'
          ? 'Quạt đối lưu'
          : 'Đèn nhiệt sưởi ấm (HLamp)'
      const modeText =
        mode === 'auto' ? 'chế độ Tự động (Auto)' : mode === 'on' ? 'Bật thủ công' : 'Tắt thủ công'
      setToast({
        message: `Đã chuyển ${displayName} sang ${modeText} thành công.`,
        type: 'success',
      })
    } else {
      setToast({
        message: res.message,
        type: 'error',
      })
    }
  }

  const blackoutConfirmed = blackoutActive === true
  const statusText = (state: EdgeState) =>
    state === null ? '— / Chưa nhận được dữ liệu' : state ? 'Đang hoạt động' : 'Đã tắt'

  return (
    <Card className="p-6 border border-slate-700/50 bg-slate-950/40 relative">
      <div className="mb-4">
        <h3 className="font-semibold text-foreground text-lg">Thiết bị trong phòng nấm</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Theo dõi và điều khiển cưỡng bức thiết bị trong dải an toàn sinh học
        </p>
      </div>

      <div className="space-y-3">
        <ActuatorStatusRow
          name="Quạt đối lưu"
          description="Giúp không khí lưu thông, hạ nhiệt và giảm CO₂"
          icon={<Wind className="w-5 h-5 text-cyan-400" />}
          state={fanActive}
          overrideMode={fanMode}
          onOverrideChange={(mode) => handleOverrideChange('fan', mode)}
        />
        <ActuatorStatusRow
          name="Đèn nhiệt sưởi ấm (HLamp)"
          description="Tự động sưởi khi phòng nấm cần tăng nhiệt (Khóa khi ra quả)"
          icon={<Zap className="w-5 h-5 text-amber-400" />}
          state={lampStageActive}
          overrideMode={lampMode}
          onOverrideChange={(mode) => handleOverrideChange('lamp', mode)}
          locked={cropDayInt > 8}
          lockReason={
            cropDayInt > 8
              ? 'Khóa tự động trong giai đoạn ra quả thể để tránh làm khô nấm'
              : undefined
          }
        />
        <ActuatorStatusRow
          name="Thiết bị làm ấm nước"
          description="Thiết bị này chưa được lắp đặt phần cứng"
          icon={<Zap className="w-5 h-5 text-blue-400" />}
          state={heaterWaterActive}
          overrideMode="auto"
          onOverrideChange={() => {}}
          uninstalled={true}
        />
        <ActuatorStatusRow
          name="Máy tạo ẩm siêu âm"
          description="Tự động phun sương theo độ ẩm (Khóa giờ trưa 11:00 - 13:30)"
          icon={<CloudFog className="w-5 h-5 text-teal-400" />}
          state={mistActive}
          overrideMode={mistMode}
          onOverrideChange={(mode) => handleOverrideChange('mist', mode)}
          locked={blackoutConfirmed}
          lockReason={
            blackoutConfirmed
              ? 'Tạm ngưng phun sương giờ trưa để tránh sốc nhiệt cho nấm'
              : undefined
          }
        />
      </div>

      <div className="mt-4 p-3 rounded bg-slate-900/30 border border-slate-700/30 text-xs text-muted-foreground space-y-1">
        <div>
          Tạm ngưng phun sương:{' '}
          <span className={blackoutConfirmed ? 'text-red-400 font-semibold' : 'text-slate-400'}>
            {blackoutConfirmed
              ? 'Đang tạm ngưng'
              : blackoutActive === null
              ? '— / Chưa nhận được dữ liệu'
              : 'Không tạm ngưng'}
          </span>
        </div>
        <div>Quạt: {statusText(fanActive)}</div>
        <div>Đèn nhiệt (stage 1): {statusText(lampStageActive)}</div>
        <div>Đèn nhiệt (stage 2): {statusText(lampStage2Active)}</div>
        <div>Làm ấm nước: {statusText(heaterWaterActive)}</div>
        <div>Máy tạo ẩm: {statusText(mistActive)}</div>
      </div>

      {/* Local Toast Alert */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-md transition-all duration-300 ${
            toast.type === 'success'
              ? 'bg-gradient-to-r from-emerald-900/80 to-teal-900/80 border-emerald-500/30 text-emerald-200'
              : 'bg-gradient-to-r from-red-950/80 to-pink-950/80 border-red-500/30 text-red-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : (
            <XCircle className="w-5 h-5 text-red-400 shrink-0" />
          )}
          <span className="text-xs font-medium">{toast.message}</span>
        </div>
      )}
    </Card>
  )
}
