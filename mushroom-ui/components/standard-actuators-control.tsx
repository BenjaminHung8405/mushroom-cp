'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { useSimulation } from '@/lib/simulation-context'
import { Wind, Zap, Lock, AlertCircle } from 'lucide-react'

interface ActuatorToggleProps {
  id: string
  name: string
  description?: string
  icon: React.ReactNode
  isActive: boolean
  pwmDutyCycle?: number
  onToggle: (id: string, active: boolean) => void
  isDisabled?: boolean
}

function ActuatorToggle({
  id,
  name,
  description,
  icon,
  isActive,
  pwmDutyCycle,
  onToggle,
  isDisabled = false,
}: ActuatorToggleProps) {
  const getPWMColor = (dutyCycle: number): string => {
    if (dutyCycle < 25) return 'bg-slate-600'
    if (dutyCycle < 50) return 'bg-emerald-500'
    if (dutyCycle < 75) return 'bg-amber-500'
    return 'bg-red-500'
  }

  return (
    <div
      className={`p-4 rounded-lg border transition-all duration-300 ${
        isActive
          ? 'border-emerald-500/50 bg-emerald-950/20'
          : 'border-slate-700/50 bg-slate-900/20'
      } ${
        isDisabled
          ? 'border-red-950/40 bg-red-950/5 opacity-60 cursor-not-allowed'
          : 'cursor-pointer hover:border-emerald-500/30'
      }`}
      onClick={() => !isDisabled && onToggle(id, !isActive)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isActive ? 'bg-emerald-500/20' : isDisabled ? 'bg-red-950/30' : 'bg-slate-700/30'}`}>
            {icon}
          </div>
          <div>
            <h4 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
              {name}
              {isDisabled && <span className="text-[10px] font-bold uppercase bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded border border-red-500/20">Locked</span>}
            </h4>
            {description && (
              <p className={`text-xs mt-0.5 ${isDisabled ? 'text-red-400/80 font-medium' : 'text-muted-foreground'}`}>
                {description}
              </p>
            )}
          </div>
        </div>
        <div
          className={`w-12 h-6 rounded-full transition-colors duration-300 flex items-center px-1 ${
            isActive ? 'bg-emerald-500' : isDisabled ? 'bg-red-950/40' : 'bg-slate-700'
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white transition-transform duration-300 ${
              isActive ? 'translate-x-6' : 'translate-x-0'
            }`}
          />
        </div>
      </div>

      {/* PWM Duty Cycle Badge */}
      {pwmDutyCycle !== undefined && isActive && !isDisabled && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">PWM:</span>
          <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden max-w-xs">
            <div
              className={`${getPWMColor(pwmDutyCycle)} h-full rounded-full transition-all duration-300`}
              style={{ width: `${pwmDutyCycle}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-foreground min-w-max">
            {pwmDutyCycle.toFixed(0)}%
          </span>
        </div>
      )}

      {isDisabled && (
        <div className="flex items-center gap-1 text-[11px] text-red-400 font-medium">
          <AlertCircle size={12} />
          <span>Biological safety lock active</span>
        </div>
      )}

      {!isActive && !isDisabled && (
        <div className="text-xs text-muted-foreground">Off</div>
      )}
    </div>
  )
}

interface StandardActuatorsControlProps {
  fanPWM?: number
  lampPWM?: number
  onFanToggle?: (active: boolean) => void
  onLampToggle?: (active: boolean) => void
}

export function StandardActuatorsControl({
  fanPWM = 0,
  lampPWM = 0,
  onFanToggle,
  onLampToggle,
}: StandardActuatorsControlProps) {
  const { currentCropDay } = useSimulation()
  const [isFFanActive, setFanActive] = useState(false)
  const [isLampActive, setLampActive] = useState(false)

  const handleFanToggle = (id: string, active: boolean) => {
    setFanActive(active)
    onFanToggle?.(active)
  }

  const handleLampToggle = (id: string, active: boolean) => {
    setLampActive(active)
    onLampToggle?.(active)
  }

  const isLampsLocked = currentCropDay >= 9
  const effectiveLampActive = isLampsLocked ? false : isLampActive

  return (
    <Card className="p-6 border border-slate-700/50 bg-slate-950/40">
      <div className="mb-4">
        <h3 className="font-semibold text-foreground text-lg">Standard Actuators</h3>
        <p className="text-xs text-muted-foreground mt-1">
          General environmental controls
        </p>
      </div>

      <div className="space-y-3">
        <ActuatorToggle
          id="fan"
          name="Convection Fans"
          description="Air circulation & humidity control"
          icon={<Wind className="w-5 h-5 text-cyan-400" />}
          isActive={isFFanActive}
          pwmDutyCycle={isFFanActive ? fanPWM : undefined}
          onToggle={handleFanToggle}
        />

        <ActuatorToggle
          id="lamp"
          name="Heating Lamps"
          description={
            isLampsLocked
              ? 'Locked OFF during fruiting phase (Day 9-21)'
              : 'Spawn-running phase (Day 1-8) active heating'
          }
          icon={
            isLampsLocked ? (
              <Lock className="w-5 h-5 text-red-400" />
            ) : (
              <Zap className="w-5 h-5 text-amber-400" />
            )
          }
          isActive={effectiveLampActive}
          pwmDutyCycle={effectiveLampActive ? lampPWM : undefined}
          onToggle={handleLampToggle}
          isDisabled={isLampsLocked}
        />
      </div>

      {/* Status Summary */}
      <div className="mt-4 p-3 rounded bg-slate-900/30 border border-slate-700/30">
        <div className="text-xs text-muted-foreground space-y-1">
          <div>
            <span className="text-slate-400">Fans: </span>
            <span className={isFFanActive ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
              {isFFanActive ? `Active (${fanPWM.toFixed(0)}%)` : 'Off'}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Lamps: </span>
            <span className={effectiveLampActive ? 'text-amber-400 font-semibold' : 'text-slate-500'}>
              {isLampsLocked
                ? 'Locked OFF (Safety Lock)'
                : effectiveLampActive
                  ? `Active (${lampPWM.toFixed(0)}%)`
                  : 'Off'}
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}
