'use client'
 
import { Button } from '@/components/ui/button'
import { useBatch } from '@/lib/batch-context'
import { useSimulation } from '@/lib/simulation-context'
import { Calendar, Clock, FastForward, Pause, Play, WifiOff, Wifi } from 'lucide-react'
 
export function SimulationControlPanel() {
  const { totalCropDays } = useBatch()
  const {
    isSimulationActive,
    setIsSimulationActive,
    simulationSpeedMultiplier,
    setSimulationSpeedMultiplier,
    currentSimulatedDay,
    setCurrentSimulatedDay,
    simulatedTimeMinutes,
    setSimulatedTimeMinutes,
    deviceStatus,
    simulateDeviceOffline,
    simulateDeviceOnline,
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
    <div className="space-y-6">
      {/* Simulation Engine Toggle */}
      <div className="flex flex-col gap-2 p-4 rounded-lg bg-slate-900/40 border border-slate-800">
        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
          Chế độ giả lập
        </span>
        <div className="flex items-center gap-3">
          <Button
            onClick={() => setIsSimulationActive(!isSimulationActive)}
            variant={isSimulationActive ? 'default' : 'outline'}
            className={`flex-1 gap-2 h-9 text-xs font-bold uppercase transition-all ${
              isSimulationActive 
                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-[0_0_10px_rgba(217,119,6,0.3)]' 
                : 'text-slate-400 border-slate-700 hover:bg-slate-800'
            }`}
          >
            {isSimulationActive ? (
              <>
                <Pause className="w-4 h-4" />
                Tạm dừng giả lập
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Bắt đầu giả lập
              </>
            )}
          </Button>
        </div>

        {/* Speed Multiplier */}
        {isSimulationActive && (
          <div className="mt-2.5 space-y-1.5 animate-fadeIn">
            <span className="text-[10px] uppercase font-semibold text-slate-500 flex items-center gap-1">
              <FastForward className="w-3 h-3" />
              Tốc độ dòng thời gian
            </span>
            <div className="grid grid-cols-4 gap-1">
              {[1, 5, 10, 60].map((speed) => (
                <button
                  key={`speed-${speed}`}
                  onClick={() => setSimulationSpeedMultiplier(speed)}
                  className={`text-[10px] py-1 rounded font-bold border transition-colors ${
                    simulationSpeedMultiplier === speed
                      ? 'bg-amber-950/40 border-amber-500/50 text-amber-400'
                      : 'bg-slate-900/60 border-slate-800/80 text-slate-500 hover:text-slate-400'
                  }`}
                >
                  {speed}x
                </button>
              ))}
            </div>
            <p className="text-[9px] text-slate-500">
              * Tốc độ 60x tương đương 10 giờ trôi qua mỗi giây thực tế.
            </p>
          </div>
        )}
      </div>

      {/* Crop Day Slider */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-amber-400" />
            Ngày giả lập trong chu kỳ
          </span>
          <span className="text-xs font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
            Ngày {currentSimulatedDay} / {totalCropDays}
          </span>
        </div>
        <input
          type="range"
          min="1"
          max={totalCropDays}
          value={currentSimulatedDay}
          onChange={(e) => setCurrentSimulatedDay(parseInt(e.target.value))}
          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
        />
        <div className="flex justify-between text-[9px] text-slate-500 mt-1">
          <span>Ngày 1 (Cấy giống)</span>
          <span>Ngày {totalCropDays} (Thu hoạch)</span>
        </div>
      </div>

      {/* Time-of-Day Slider */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            Giờ giả lập trong ngày
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
        <div className="flex justify-between text-[9px] text-slate-500 mt-1">
          <span>12:00 AM</span>
          <span className="text-amber-500/70">11:00 AM - 1:30 PM (Khóa tưới)</span>
          <span>11:50 PM</span>
        </div>
      </div>

      {/* ============================================================
          LWT / DEVICE STATUS SIMULATOR
          Allows developers to test the Crimson alert UI flow without
          needing real ESP32-S3 hardware.
          ============================================================ */}
      <div className="border-t border-slate-800 pt-4 space-y-3">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center gap-1.5">
            <WifiOff className="w-3 h-3" />
            Kiểm Thử LWT (Dev Only)
          </span>
          <p className="text-[9px] text-slate-600 mt-0.5">
            Giả lập sự kiện thiết bị mất kết nối (Last Will & Testament) để kiểm tra giao diện cảnh báo Crimson.
          </p>
        </div>

        {/* Current status display */}
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-slate-500">Trạng thái hiện tại:</span>
          {deviceStatus === 'OFFLINE' && (
            <span className="font-bold text-red-400 flex items-center gap-1">
              <WifiOff className="w-3 h-3" /> OFFLINE (lwt)
            </span>
          )}
          {deviceStatus === 'ONLINE_ACTIVE' && (
            <span className="font-bold text-emerald-400 flex items-center gap-1">
              <Wifi className="w-3 h-3" /> ONLINE
            </span>
          )}
          {deviceStatus === 'UNKNOWN' && (
            <span className="font-bold text-slate-400">UNKNOWN</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={simulateDeviceOffline}
            disabled={deviceStatus === 'OFFLINE'}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase rounded border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: deviceStatus !== 'OFFLINE' ? 'rgba(220,20,60,0.08)' : undefined,
              borderColor: 'rgba(220,20,60,0.35)',
              color: '#DC143C',
            }}
          >
            <WifiOff className="w-3 h-3" />
            Ngắt kết nối
          </button>
          <button
            onClick={simulateDeviceOnline}
            disabled={deviceStatus === 'ONLINE_ACTIVE'}
            className="flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase rounded border border-emerald-700/50 bg-emerald-950/20 text-emerald-400 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Wifi className="w-3 h-3" />
            Kết nối lại
          </button>
        </div>
      </div>
    </div>
  )
}
