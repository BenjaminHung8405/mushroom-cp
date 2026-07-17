'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useRealTelemetry } from '@/lib/real-telemetry-context'
import { ArrowRight, ArrowLeft, Activity, AlertCircle, Shield, Lock } from 'lucide-react'

interface MistGeneratorControlProps {
  pwmDutyCycle?: number
}

type MotorState = 'idle' | 'forward' | 'backward'

export function MistGeneratorControl({ pwmDutyCycle = 0 }: MistGeneratorControlProps) {
  const { middayBlackoutActive } = useRealTelemetry()
  const [motorState, setMotorState] = useState<MotorState>('idle')
  const [position, setPosition] = useState(50) // 0-100% travel
  const [endLimitActivated, setEndLimitActivated] = useState(false)

  const isBlackoutActive = middayBlackoutActive === true
  const blackoutUnknown = middayBlackoutActive === null

  // Automatically halt motor if blackout is triggered
  useEffect(() => {
    if (isBlackoutActive) {
      setMotorState('idle')
    }
  }, [isBlackoutActive])

  const handleForward = () => {
    if (isBlackoutActive) return
    setMotorState('forward')
    const newPosition = Math.min(position + 10, 100)
    setPosition(newPosition)
    if (newPosition >= 95) {
      setEndLimitActivated(true)
      setTimeout(() => {
        setMotorState('idle')
        setEndLimitActivated(false)
      }, 1500)
    }
  }

  const handleBackward = () => {
    if (isBlackoutActive) return
    setMotorState('backward')
    const newPosition = Math.max(position - 10, 0)
    setPosition(newPosition)
    if (newPosition <= 5) {
      setEndLimitActivated(true)
      setTimeout(() => {
        setMotorState('idle')
        setEndLimitActivated(false)
      }, 1500)
    }
  }

  const handleStop = () => {
    setMotorState('idle')
  }

  const getMotorStateColor = (state: MotorState): string => {
    if (isBlackoutActive) return 'bg-red-950/10 border-red-900/30'
    switch (state) {
      case 'idle':
        return 'bg-slate-700/40 border-slate-600/50'
      case 'forward':
        return 'bg-emerald-950/30 border-emerald-500/30'
      case 'backward':
        return 'bg-blue-950/30 border-blue-500/30'
    }
  }

  const getMotorStateLabel = (state: MotorState): string => {
    if (isBlackoutActive) return 'Đã khóa TẮT (Khóa nhiệt độ)'
    switch (state) {
      case 'idle':
        return 'Đang chờ'
      case 'forward':
        return 'Đang tiến'
      case 'backward':
        return 'Đang lùi'
    }
  }

  const getMotorStateDot = (state: MotorState): string => {
    if (isBlackoutActive) return 'bg-red-500'
    switch (state) {
      case 'idle':
        return 'bg-slate-600'
      case 'forward':
        return 'bg-emerald-500'
      case 'backward':
        return 'bg-blue-500'
    }
  }

  return (
    <Card className={`p-6 border transition-all duration-300 ${
      isBlackoutActive ? 'border-red-900/30 bg-red-950/5' : 'border-slate-700/50 bg-slate-950/40'
    }`}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isBlackoutActive ? 'bg-red-950/40' : 'bg-primary/20'}`}>
            <Activity className={`w-5 h-5 ${isBlackoutActive ? 'text-red-400' : 'text-emerald-400'}`} />
          </div>
          <div>
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              Máy phun sương
              {isBlackoutActive && (
                <span className="text-[10px] font-bold uppercase bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded border border-red-500/20">
                  Đã khóa
                </span>
              )}
            </h3>
            <p className="text-xs text-muted-foreground">Di chuyển dọc theo đường ray để tưới đều</p>
          </div>
        </div>

        {/* Midday Thermal Guard Shield Badge */}
        {isBlackoutActive && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.15)] animate-pulse">
            <Shield className="w-4 h-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider">Đang tạm ngưng để bảo vệ nấm</span>
          </div>
        )}
      </div>

      {/* Motor State Display */}
      <div className={`rounded-lg p-4 mb-4 border ${getMotorStateColor(motorState)}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${getMotorStateDot(motorState)} ${isBlackoutActive && 'animate-pulse'}`} />
            <span className="text-sm font-semibold text-foreground">
              {getMotorStateLabel(motorState)}
            </span>
          </div>
          {endLimitActivated && !isBlackoutActive && (
            <div className="flex items-center gap-2 px-2 py-1 rounded bg-amber-500/20 border border-amber-500/40">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              <span className="text-xs text-amber-300">Đã đến cuối đường ray</span>
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {isBlackoutActive ? (
            <span className="text-red-400 font-medium">Tự động ngưng phun sương để tránh sốc nhiệt cho nấm.</span>
          ) : (
            `Máy phun sương: ${motorState === 'forward' ? '→ Tiến' : motorState === 'backward' ? '← Lùi' : '⊘ Đã dừng'}`
          )}
        </p>
      </div>

      {/* Position Slider */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-muted-foreground">Vị trí máy phun sương</span>
          <span className="text-sm font-semibold text-foreground">{position}%</span>
        </div>
        <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              isBlackoutActive
                ? 'bg-gradient-to-r from-red-800 to-red-600'
                : 'bg-gradient-to-r from-emerald-600 to-emerald-400'
            }`}
            style={{ width: `${position}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground mt-1">
          <span>Bắt đầu</span>
          <span>Kết thúc</span>
        </div>
      </div>

      {/* PWM Duty Cycle Display */}
      {pwmDutyCycle !== undefined && (
        <div className="mb-6 p-3 rounded bg-slate-900/30 border border-slate-700/30">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-muted-foreground">Cường độ hoạt động</span>
            <span className="text-sm font-semibold text-foreground">
              {isBlackoutActive ? '0.0%' : `${pwmDutyCycle.toFixed(1)}%`}
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isBlackoutActive
                  ? 'bg-red-550 w-0'
                  : pwmDutyCycle < 25
                    ? 'bg-slate-600'
                    : pwmDutyCycle < 50
                      ? 'bg-emerald-500'
                      : pwmDutyCycle < 75
                        ? 'bg-amber-500'
                        : 'bg-red-500'
              }`}
              style={{ width: `${isBlackoutActive ? 0 : pwmDutyCycle}%` }}
            />
          </div>
        </div>
      )}

      {/* Control Buttons */}
      <div className="flex gap-2">
        <Button
          onClick={handleBackward}
          disabled={motorState === 'backward' || isBlackoutActive}
          variant={motorState === 'backward' ? 'default' : 'outline'}
          className="flex-1"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Lùi
        </Button>
        <Button onClick={handleStop} disabled={isBlackoutActive} variant="outline" className="flex-1">
          Dừng
        </Button>
        <Button
          onClick={handleForward}
          disabled={motorState === 'forward' || isBlackoutActive}
          variant={motorState === 'forward' ? 'default' : 'outline'}
          className="flex-1"
        >
          Tiến
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>

      {/* Status Information */}
      <div className="mt-4 p-3 rounded bg-slate-900/20 border border-slate-700/30">
        <p className="text-xs text-muted-foreground">
          {isBlackoutActive ? (
            <span className="text-red-400 font-medium flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" />
              ESP32 đang áp dụng Blackout an toàn 11:00–13:30.
            </span>
          ) : blackoutUnknown ? (
            'Chưa xác minh trạng thái Blackout từ ESP32.'
          ) : (
            '💡 Máy sẽ tự dừng khi đến hai đầu đường ray'
          )}
        </p>
      </div>
    </Card>
  )
}
