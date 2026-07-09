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
  currentValue: number
  setpointValue: number
  unit: string
  status: 'optimal' | 'warning' | 'critical'
  trend?: number
  pwmDutyCycle?: number
}

const sensorConfig = {
  humidity: {
    icon: Droplets,
    label: 'Humidity (SHT30)',
    optimal: [70, 90],
    warning: [60, 95],
    color: 'text-blue-400',
  },
  temperature: {
    icon: Thermometer,
    label: 'Substrate Temp (DS18B20)',
    optimal: [28, 35],
    warning: [20, 38],
    color: 'text-orange-400',
  },
  co2: {
    icon: Wind,
    label: 'CO2 Levels (SCD30)',
    optimal: [800, 1200],
    warning: [600, 1500],
    color: 'text-cyan-400',
  },
}

const getStatusColor = (
  status: 'optimal' | 'warning' | 'critical'
): string => {
  switch (status) {
    case 'optimal':
      return 'border-emerald-500/30 bg-emerald-950/20'
    case 'warning':
      return 'border-amber-500/30 bg-amber-950/20'
    case 'critical':
      return 'border-red-500/30 bg-red-950/20'
  }
}

const getStatusDot = (status: 'optimal' | 'warning' | 'critical'): string => {
  switch (status) {
    case 'optimal':
      return 'bg-emerald-500'
    case 'warning':
      return 'bg-amber-500'
    case 'critical':
      return 'bg-red-500'
  }
}

const getPWMColor = (dutyCycle: number): string => {
  if (dutyCycle < 25) return 'bg-slate-600'
  if (dutyCycle < 50) return 'bg-emerald-500'
  if (dutyCycle < 75) return 'bg-amber-500'
  return 'bg-red-500'
}

export function SensorDataCard({
  sensorType,
  currentValue,
  setpointValue,
  unit,
  status,
  trend,
  pwmDutyCycle,
}: SensorDataCardProps) {
  const config = sensorConfig[sensorType]
  const Icon = config.icon
  const errorDelta = setpointValue - currentValue
  
  // Format values: CO2 as integer, others with .toFixed(1)
  const formattedCurrent = sensorType === 'co2' ? Math.round(currentValue) : currentValue.toFixed(1)
  const formattedSetpoint = sensorType === 'co2' ? Math.round(setpointValue) : setpointValue.toFixed(1)
  const formattedError = sensorType === 'co2' ? Math.round(errorDelta) : errorDelta.toFixed(1)

  return (
    <Card className={`p-4 md:p-6 border overflow-hidden relative ${getStatusColor(status)}`}>
      {/* Status Indicator Dot */}
      <div className="absolute top-4 right-4">
        <div className={`w-3 h-3 rounded-full ${getStatusDot(status)} animate-pulse`} />
      </div>

      {/* Header */}
      <div className="flex items-center gap-3 mb-3 md:mb-4">
        <div className="p-2 rounded-lg bg-primary/20">
          <Icon className={`w-5 h-5 ${config.color}`} />
        </div>
        <h3 className="text-xs md:text-sm font-medium text-muted-foreground line-clamp-2">{config.label}</h3>
      </div>

      {/* Primary Value Display */}
      <div className="mb-2 md:mb-3">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-2xl md:text-3xl font-bold text-foreground">{formattedCurrent}</span>
          <span className="text-xs md:text-sm text-muted-foreground">{unit}</span>
        </div>

        {/* Trend Indicator */}
        {trend !== undefined && (
          <div className="flex items-center gap-1 text-xs text-emerald-400">
            {trend > 0 ? (
              <TrendingUp size={12} />
            ) : (
              <TrendingDown size={12} />
            )}
            <span className="truncate">{Math.abs(trend).toFixed(1)}% change</span>
          </div>
        )}
      </div>

      {/* Error Delta Display (Fuzzy Logic) */}
      <div className="bg-slate-900/40 rounded px-2 py-2 mb-2 md:mb-3 border border-slate-700/50">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-muted-foreground">Error (E)</span>
          <span className="text-xs font-semibold text-foreground">
            {errorDelta > 0 ? '+' : ''}{formattedError}{unit}
          </span>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground gap-1">
          <span className="truncate">Set: {formattedSetpoint}{unit}</span>
          <span className="truncate">Now: {formattedCurrent}{unit}</span>
        </div>
      </div>

      {/* PWM Duty Cycle (if applicable) */}
      {pwmDutyCycle !== undefined && (
        <div className="mb-2 md:mb-3">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-muted-foreground">PWM</span>
            <span className="text-xs font-semibold text-foreground">
              {Math.round(pwmDutyCycle)}%
            </span>
          </div>
          <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
            <div
              className={`${getPWMColor(pwmDutyCycle)} h-full rounded-full transition-all duration-300`}
              style={{ width: `${pwmDutyCycle}%` }}
            />
          </div>
        </div>
      )}

      {/* Threshold Range */}
      <div className="pt-2 border-t border-border/50">
        <div className="flex justify-between text-xs text-muted-foreground gap-1">
          <span className="truncate">Opt: {config.optimal[0]}-{config.optimal[1]}{unit}</span>
          {status !== 'optimal' && (
            <div className="flex items-center gap-1 text-amber-400 ml-auto">
              <AlertCircle size={10} />
              <span className="hidden sm:inline">Out of range</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
