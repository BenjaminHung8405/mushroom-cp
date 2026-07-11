'use client'

import { Card } from '@/components/ui/card'
import {
  AlertCircle,
  Droplets,
  Thermometer,
  TrendingDown,
  TrendingUp,
  Wind,
} from 'lucide-react'

interface SensorDataCardProps {
  sensorType: 'humidity' | 'temperature' | 'co2'
  currentValue: number | null
  setpointValue: number | null
  unit: string
  status: 'optimal' | 'warning' | 'critical' | 'empty'
  trend?: number | null
  /** Optional boolean actuator state (ON/OFF) — replaces PWM for edge-hysteresis */
  actuatorActive?: boolean
  lastUpdated?: string | null
}

const sensorConfig = {
  humidity: {
    icon: Droplets,
    label: 'Độ ẩm không khí (SHT30)',
    optimal: [70, 90] as [number, number],
    color: 'text-blue-400',
  },
  temperature: {
    icon: Thermometer,
    label: 'Nhiệt độ không khí (SHT30)',
    optimal: [28, 35] as [number, number],
    color: 'text-orange-400',
  },
  co2: {
    icon: Wind,
    label: 'Mức CO₂ (SCD30)',
    optimal: [800, 1200] as [number, number],
    color: 'text-cyan-400',
  },
}

const getStatusColor = (
  status: 'optimal' | 'warning' | 'critical' | 'empty',
): string => {
  switch (status) {
    case 'optimal':
      return 'border-emerald-500/30 bg-emerald-950/20'
    case 'warning':
      return 'border-amber-500/30 bg-amber-950/20'
    case 'critical':
      return 'border-red-500/30 bg-red-950/20'
    case 'empty':
      return 'border-slate-700/40 bg-slate-950/30'
  }
}

const getStatusDot = (
  status: 'optimal' | 'warning' | 'critical' | 'empty',
): string => {
  switch (status) {
    case 'optimal':
      return 'bg-emerald-500'
    case 'warning':
      return 'bg-amber-500'
    case 'critical':
      return 'bg-red-500'
    case 'empty':
      return 'bg-slate-500'
  }
}

export function SensorDataCard({
  sensorType,
  currentValue,
  setpointValue,
  unit,
  status,
  trend,
  actuatorActive,
  lastUpdated,
}: SensorDataCardProps) {
  const config = sensorConfig[sensorType]
  const Icon = config.icon
  const hasValue = currentValue !== null && currentValue !== undefined
  const hasSetpoint = setpointValue !== null && setpointValue !== undefined
  const errorDelta =
    hasValue && hasSetpoint ? setpointValue - currentValue : null

  const formattedCurrent = !hasValue
    ? '—'
    : sensorType === 'co2'
      ? Math.round(currentValue)
      : currentValue.toFixed(1)
  const formattedSetpoint = !hasSetpoint
    ? '—'
    : sensorType === 'co2'
      ? Math.round(setpointValue)
      : setpointValue.toFixed(1)
  const formattedError =
    errorDelta === null
      ? '—'
      : sensorType === 'co2'
        ? Math.round(errorDelta)
        : errorDelta.toFixed(1)

  return (
    <Card className={`p-4 md:p-6 border overflow-hidden relative ${getStatusColor(status)}`}>
      <div className="absolute top-4 right-4">
        <div className={`w-3 h-3 rounded-full ${getStatusDot(status)} ${status !== 'empty' ? 'animate-pulse' : ''}`} />
      </div>

      <div className="flex items-center gap-3 mb-3 md:mb-4">
        <div className="p-2 rounded-lg bg-primary/20">
          <Icon className={`w-5 h-5 ${config.color}`} />
        </div>
        <h3 className="text-xs md:text-sm font-medium text-muted-foreground line-clamp-2">
          {config.label}
        </h3>
      </div>

      <div className="mb-2 md:mb-3">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-2xl md:text-3xl font-bold text-foreground">
            {formattedCurrent}
          </span>
          {hasValue && (
            <span className="text-xs md:text-sm text-muted-foreground">{unit}</span>
          )}
        </div>

        {trend !== null && trend !== undefined && hasValue && (
          <div className="flex items-center gap-1 text-xs text-emerald-400">
            {trend > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            <span className="truncate">{Math.abs(trend).toFixed(1)}{unit} thay đổi</span>
          </div>
        )}

        {!hasValue && (
          <p className="text-xs text-slate-500">Chưa nhận telemetry thật</p>
        )}
      </div>

      <div className="bg-slate-900/40 rounded px-2 py-2 mb-2 md:mb-3 border border-slate-700/50">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-muted-foreground">Sai lệch (E)</span>
          <span className="text-xs font-semibold text-foreground">
            {errorDelta !== null && errorDelta > 0 ? '+' : ''}
            {formattedError}
            {errorDelta !== null ? unit : ''}
          </span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground gap-1">
          <span className="truncate">Đặt: {formattedSetpoint}{hasSetpoint ? unit : ''}</span>
          <span className="truncate">Hiện tại: {formattedCurrent}{hasValue ? unit : ''}</span>
        </div>
      </div>

      {actuatorActive !== undefined && (
        <div className="mb-2 md:mb-3 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Actuator</span>
          <span
            className={
              actuatorActive
                ? 'text-emerald-400 font-semibold'
                : 'text-slate-500 font-semibold'
            }
          >
            {actuatorActive ? 'ON' : 'OFF'}
          </span>
        </div>
      )}

      <div className="pt-2 border-t border-border/50">
        <div className="flex justify-between text-xs text-muted-foreground gap-1">
          <span className="truncate">
            Tối ưu: {config.optimal[0]}-{config.optimal[1]}
            {unit}
          </span>
          {status !== 'optimal' && status !== 'empty' && (
            <div className="flex items-center gap-1 text-amber-400 ml-auto">
              <AlertCircle size={10} />
              <span className="hidden sm:inline">Ngoài ngưỡng</span>
            </div>
          )}
        </div>
        {lastUpdated && (
          <p className="text-[10px] text-slate-600 mt-1 truncate">
            Cập nhật: {new Date(lastUpdated).toLocaleTimeString('vi-VN')}
          </p>
        )}
      </div>
    </Card>
  )
}
