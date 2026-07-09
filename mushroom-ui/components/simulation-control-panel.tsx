'use client'

import { Card } from '@/components/ui/card'
import { useSimulation } from '@/lib/simulation-context'
import { Calendar, Clock, Zap, Battery, Sliders } from 'lucide-react'

export function SimulationControlPanel() {
  const {
    currentCropDay,
    setCurrentCropDay,
    simulatedTimeMinutes,
    setSimulatedTimeMinutes,
    powerSource,
    setPowerSource,
  } = useSimulation()

  const formatMinutesToTime = (totalMinutes: number): string => {
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    const ampm = hours >= 12 ? 'PM' : 'AM'
    const displayHours = hours % 12 === 0 ? 12 : hours % 12
    const displayMinutes = minutes.toString().padStart(2, '0')
    return `${displayHours}:${displayMinutes} ${ampm}`
  }

  return (
    <Card className="p-6 border border-slate-700/50 bg-slate-950/40">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-primary/20">
          <Sliders className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground">Simulation Control</h3>
          <p className="text-xs text-muted-foreground">Adjust parameters to test biological rules</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Crop Day Slider */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Crop Cycle Day
            </span>
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Day {currentCropDay} of 21
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="21"
            value={currentCropDay}
            onChange={(e) => setCurrentCropDay(parseInt(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
          <div className="flex justify-between text-[10px] text-slate-500 mt-1">
            <span>Day 1 (Spawn)</span>
            <span>Day 9 (Fruiting)</span>
            <span>Day 21 (Cycle End)</span>
          </div>
        </div>

        {/* Time-of-Day Slider */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Simulated Time
            </span>
            <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
              {formatMinutesToTime(simulatedTimeMinutes)}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1439"
            step="10"
            value={simulatedTimeMinutes}
            onChange={(e) => setSimulatedTimeMinutes(parseInt(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
          />
          <div className="flex justify-between text-[10px] text-slate-500 mt-1">
            <span>12:00 AM</span>
            <span className="text-amber-500/80 font-medium">11:00 AM - 1:30 PM (Blackout)</span>
            <span>11:50 PM</span>
          </div>
        </div>

        {/* Power Source Selector */}
        <div>
          <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5 mb-2.5">
            <Zap className="w-3.5 h-3.5" />
            Infrastructure Power Status
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPowerSource('GRID_POWER')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-semibold transition-all ${
                powerSource === 'GRID_POWER'
                  ? 'bg-emerald-950/30 border-emerald-500/50 text-emerald-400'
                  : 'bg-slate-900/20 border-slate-800 text-slate-400 hover:border-slate-700/50'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Grid Power
            </button>
            <button
              onClick={() => setPowerSource('UPS_BATTERY')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-xs font-semibold transition-all ${
                powerSource === 'UPS_BATTERY'
                  ? 'bg-amber-950/30 border-amber-500/50 text-amber-400 animate-pulse'
                  : 'bg-slate-900/20 border-slate-800 text-slate-400 hover:border-slate-700/50'
              }`}
            >
              <Battery className="w-3.5 h-3.5" />
              UPS Battery
            </button>
          </div>
        </div>
      </div>
    </Card>
  )
}
