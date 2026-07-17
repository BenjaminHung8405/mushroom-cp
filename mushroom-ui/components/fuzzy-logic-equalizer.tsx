'use client'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useBatch, Checkpoint, DayTrack } from '@/lib/batch-context'
import { useSelectedDevice } from '@/lib/selected-device-context'
import { useRealTelemetry } from '@/lib/real-telemetry-context'
import { LightTimelineBlock } from '@/lib/types'
import { AlertCircle, Lightbulb, Lock, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  updateBatchCheckpoints,
  type CheckpointInput,
} from '@/lib/batch-api'
import { postApplyCropProfile } from '@/lib/telemetry-api'

interface TimelineProps {
  title: string
  min: number
  max: number
  unit: string
  checkpoints: Checkpoint[]
  onCheckpointChange: (checkpoints: Checkpoint[]) => void
  isCurve?: boolean
  optimalRange?: [number, number]
  onOptimalRangeChange?: (range: [number, number]) => void
}

function Timeline({
  title,
  min,
  max,
  unit,
  checkpoints,
  onCheckpointChange,
  isCurve = true,
  optimalRange,
  onOptimalRangeChange,
}: TimelineProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const { totalCropDays } = useBatch()
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [hoveredDay, setHoveredDay] = useState<number | null>(null)

  // Local string states to isolate re-render storm on typing and prevent decimal input glitches
  const [localMinStr, setLocalMinStr] = useState<string>(optimalRange ? String(optimalRange[0]) : '')
  const [localMaxStr, setLocalMaxStr] = useState<string>(optimalRange ? String(optimalRange[1]) : '')

  const rangeStart = optimalRange?.[0]
  const rangeEnd = optimalRange?.[1]

  // Keep local string states in sync when optimalRange changes from outside (e.g. profile change)
  useEffect(() => {
    if (optimalRange) {
      setLocalMinStr(String(optimalRange[0]))
      setLocalMaxStr(String(optimalRange[1]))
    }
  }, [rangeStart, rangeEnd])

  const handleMinBlur = () => {
    if (!optimalRange) return
    const val = parseFloat(localMinStr)
    const currentMax = parseFloat(localMaxStr) || optimalRange[1]
    if (!isNaN(val) && val >= min && val < currentMax) {
      onOptimalRangeChange?.([val, currentMax])
    } else {
      setLocalMinStr(String(optimalRange[0]))
    }
  }

  const handleMaxBlur = () => {
    if (!optimalRange) return
    const val = parseFloat(localMaxStr)
    const currentMin = parseFloat(localMinStr) || optimalRange[0]
    if (!isNaN(val) && val <= max && val > currentMin) {
      onOptimalRangeChange?.([currentMin, val])
    } else {
      setLocalMaxStr(String(optimalRange[1]))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, type: 'min' | 'max') => {
    if (e.key === 'Enter') {
      if (type === 'min') {
        handleMinBlur()
      } else {
        handleMaxBlur()
      }
      e.currentTarget.blur()
    }
  }

  const [canvasDimensions, setCanvasDimensions] = useState({
    CANVAS_WIDTH: 800,
    CANVAS_HEIGHT: 200,
    PADDING: 40,
  })

  useEffect(() => {
    const updateDimensions = () => {
      const width = Math.min(window.innerWidth - 48, 800)
      setCanvasDimensions({
        CANVAS_WIDTH: width,
        CANVAS_HEIGHT: window.innerWidth < 768 ? 150 : 200,
        PADDING: window.innerWidth < 768 ? 30 : 40,
      })
    }

    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [])

  const CANVAS_WIDTH = canvasDimensions.CANVAS_WIDTH
  const CANVAS_HEIGHT = canvasDimensions.CANVAS_HEIGHT
  const PADDING = canvasDimensions.PADDING
  const GRID_WIDTH = (CANVAS_WIDTH - PADDING * 2) / totalCropDays

  const snapToGrid = (value: number, min: number, max: number): number => {
    const range = max - min
    const normalized = (value - min) / range
    const snapped = Math.round(normalized * (range / 0.5)) * 0.5
    return Math.max(min, Math.min(max, snapped + min))
  }

  const valueToY = (value: number): number => {
    const normalized = (value - min) / (max - min)
    return CANVAS_HEIGHT - PADDING - normalized * (CANVAS_HEIGHT - PADDING * 2)
  }

  const yToValue = (y: number): number => {
    const normalized = (CANVAS_HEIGHT - PADDING - y) / (CANVAS_HEIGHT - PADDING * 2)
    return min + normalized * (max - min)
  }

  const xToDay = (x: number): number => {
    const relativeX = x - PADDING
    const dayIndex = Math.round(relativeX / GRID_WIDTH)
    return Math.max(1, Math.min(totalCropDays, dayIndex + 1))
  }

  const dayToX = (day: number): number => {
    return PADDING + (day - 1) * GRID_WIDTH
  }

  const handleNodeMouseDown = (index: number) => {
    setDraggingIndex(index)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return

    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (draggingIndex !== null) {
      const checkpoint = checkpoints[draggingIndex]
      if (checkpoint.day !== 1 && checkpoint.day !== totalCropDays) {
        let newValue = yToValue(y)
        newValue = snapToGrid(newValue, min, max)

        const newCheckpoints = [...checkpoints]
        newCheckpoints[draggingIndex] = {
          ...newCheckpoints[draggingIndex],
          value: newValue,
        }

        onCheckpointChange(newCheckpoints)
      } else {
        let newValue = yToValue(y)
        newValue = snapToGrid(newValue, min, max)

        const newCheckpoints = [...checkpoints]
        newCheckpoints[draggingIndex] = {
          ...newCheckpoints[draggingIndex],
          value: newValue,
        }

        onCheckpointChange(newCheckpoints)
      }
    } else {
      if (x > PADDING && x < CANVAS_WIDTH - PADDING) {
        setHoveredDay(xToDay(x))
      } else {
        setHoveredDay(null)
      }
    }
  }

  const handleMouseUp = () => {
    setDraggingIndex(null)
  }

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (!canvasRef.current) return

    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (x < PADDING || x > CANVAS_WIDTH - PADDING) return

    const day = xToDay(x)
    const value = snapToGrid(yToValue(y), min, max)

    const existingIndex = checkpoints.findIndex((cp) => cp.day === day)
    if (existingIndex !== -1) return

    const newCheckpoints = [...checkpoints, { day, value }].sort((a, b) => a.day - b.day)
    onCheckpointChange(newCheckpoints)
  }

  const handleNodeDoubleClick = (index: number) => {
    const checkpoint = checkpoints[index]
    if (checkpoint.day === 1 || checkpoint.day === totalCropDays) return

    const newCheckpoints = checkpoints.filter((_, i) => i !== index)
    onCheckpointChange(newCheckpoints)
  }

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (draggingIndex !== null) {
        setDraggingIndex(null)
      }
    }

    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [draggingIndex])

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-foreground text-sm sm:text-base">{title}</h4>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Ngưỡng: {min}-{max}{unit}
          </span>
          {optimalRange && (
            onOptimalRangeChange ? (
              <div className="flex items-center gap-1.5 bg-slate-900/50 border border-slate-700/50 rounded px-2 py-0.5 text-xs text-emerald-400">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Phù hợp:</span>
                <input
                  type="number"
                  min={min}
                  max={parseFloat(localMaxStr) || optimalRange[1]}
                  step={0.5}
                  value={localMinStr}
                  onChange={(e) => setLocalMinStr(e.target.value)}
                  onBlur={handleMinBlur}
                  onKeyDown={(e) => handleKeyDown(e, 'min')}
                  className="w-10 bg-slate-800 border border-slate-700/50 text-center rounded text-foreground focus:outline-none focus:border-emerald-500/50 py-0.5 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span>-</span>
                <input
                  type="number"
                  min={parseFloat(localMinStr) || optimalRange[0]}
                  max={max}
                  step={0.5}
                  value={localMaxStr}
                  onChange={(e) => setLocalMaxStr(e.target.value)}
                  onBlur={handleMaxBlur}
                  onKeyDown={(e) => handleKeyDown(e, 'max')}
                  className="w-10 bg-slate-800 border border-slate-700/50 text-center rounded text-foreground focus:outline-none focus:border-emerald-500/50 py-0.5 text-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span>{unit}</span>
              </div>
            ) : (
              <span className="text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-400">
                Phù hợp: {optimalRange[0]}-{optimalRange[1]}{unit}
              </span>
            )
          )}
        </div>
      </div>

      <div
        ref={canvasRef}
        className="relative w-full bg-slate-900/30 border border-slate-700/50 rounded-lg overflow-hidden"
        style={{ height: CANVAS_HEIGHT, userSelect: 'none' }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          handleMouseUp()
          setHoveredDay(null)
        }}
      >
        <svg
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="absolute inset-0"
        >
          <rect
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            fill="transparent"
            style={{ cursor: hoveredDay && draggingIndex === null ? 'crosshair' : 'default' }}
            onClick={handleOverlayClick}
          />

          {Array.from({ length: totalCropDays }).map((_, i) => {
            const day = i + 1
            const showLabel = totalCropDays <= 21 
              ? true 
              : totalCropDays <= 31 
                ? (day % 2 === 1 || day === totalCropDays)
                : (day === 1 || day % 5 === 0 || day === totalCropDays)
            return (
              <g key={`vgrid-${i}`} style={{ pointerEvents: 'none' }}>
                <line
                  x1={dayToX(day)}
                  y1={PADDING}
                  x2={dayToX(day)}
                  y2={CANVAS_HEIGHT - PADDING}
                  stroke="rgba(255,255,255,0.05)"
                  strokeWidth="1"
                />
                {showLabel && (
                  <text
                    x={dayToX(day)}
                    y={CANVAS_HEIGHT - PADDING + 20}
                    fontSize="10"
                    fill="rgba(255,255,255,0.4)"
                    textAnchor="middle"
                  >
                    {day}
                  </text>
                )}
              </g>
            )
          })}

          {Array.from({ length: Math.round((max - min) / 0.5) + 1 }).map((_, i) => {
            const value = min + i * 0.5
            const y = valueToY(value)
            return (
              <line
                key={`hgrid-${i}`}
                x1={PADDING}
                y1={y}
                x2={CANVAS_WIDTH - PADDING}
                y2={y}
                stroke="rgba(255,255,255,0.03)"
                strokeWidth="1"
                style={{ pointerEvents: 'none' }}
              />
            )
          })}

          <text x="10" y={valueToY(max) + 4} fontSize="10" fill="rgba(255,255,255,0.5)" style={{ pointerEvents: 'none' }}>
            {max}{unit}
          </text>
          <text x="10" y={valueToY(min) + 6} fontSize="10" fill="rgba(255,255,255,0.5)" style={{ pointerEvents: 'none' }}>
            {min}{unit}
          </text>

          {optimalRange && isCurve && (
            <rect
              x={PADDING}
              y={valueToY(optimalRange[1])}
              width={CANVAS_WIDTH - PADDING * 2}
              height={valueToY(optimalRange[0]) - valueToY(optimalRange[1])}
              fill="rgba(16, 185, 129, 0.05)"
              stroke="rgba(16, 185, 129, 0.2)"
              strokeWidth="1"
              strokeDasharray="4 4"
              style={{ pointerEvents: 'none' }}
            />
          )}

          {isCurve && checkpoints.length > 1 && (
            <polyline
              points={checkpoints
                .map((cp) => `${dayToX(cp.day)},${valueToY(cp.value)}`)
                .join(' ')}
              fill="none"
              stroke="rgba(16, 185, 129, 0.6)"
              strokeWidth="2"
              style={{ pointerEvents: 'none' }}
            />
          )}

          {checkpoints.map((cp, idx) => (
            <g key={`node-${idx}`}>
              <circle
                cx={dayToX(cp.day)}
                cy={valueToY(cp.value)}
                r="24"
                fill="transparent"
                style={{ pointerEvents: 'auto', cursor: 'grab' }}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  handleNodeMouseDown(idx)
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  handleNodeDoubleClick(idx)
                }}
                onClick={(e) => {
                  e.stopPropagation()
                }}
              />
              <circle
                cx={dayToX(cp.day)}
                cy={valueToY(cp.value)}
                r="6"
                fill={draggingIndex === idx ? 'rgba(16, 185, 129, 0.8)' : 'rgba(16, 185, 129, 0.6)'}
                stroke="rgba(16, 185, 129, 1)"
                strokeWidth="2"
                style={{ pointerEvents: 'none' }}
              />
              <text
                x={dayToX(cp.day)}
                y={valueToY(cp.value) - 12}
                fontSize="11"
                fill="rgba(255,255,255,0.7)"
                textAnchor="middle"
                fontWeight="bold"
                style={{ pointerEvents: 'none' }}
              >
                {cp.value.toFixed(1)}{unit}
              </text>
            </g>
          ))}

          {hoveredDay && draggingIndex === null && (
            <text
              x={dayToX(hoveredDay)}
              y={PADDING - 10}
              fontSize="16"
              fill="rgba(16, 185, 129, 0.7)"
              textAnchor="middle"
              style={{ pointerEvents: 'none' }}
            >
              +
            </text>
          )}
        </svg>
      </div>

      <p className="text-xs text-muted-foreground mt-2 flex items-start gap-1.5">
        <Lightbulb className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
        <span>
          <strong>Nhấp</strong> vào biểu đồ để thêm nút (làm tròn theo bước 0,5). <strong>Kéo</strong> nút để
          điều chỉnh. <strong>Nhấp đúp</strong> vào nút trung gian để xóa (ngày 1 và {totalCropDays} bị khóa).
        </span>
      </p>
    </div>
  )
}

interface LightScheduleProps {
  dayStates: DayTrack[]
  onStatesChange: (states: DayTrack[]) => void
}

function LightSchedule({
  dayStates,
  onStatesChange,
}: LightScheduleProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { totalCropDays, spawnRunningEndDay } = useBatch()
  const [draggingHandle, setDraggingHandle] = useState<{
    blockIndex: number
    type: 'left' | 'right'
    originalStartDay: number
    originalEndDay: number
  } | null>(null)

  const getActiveBlocks = (): Array<{ startDay: number; endDay: number }> => {
    const blocks: Array<{ startDay: number; endDay: number }> = []
    let currentStart: number | null = null

    dayStates.forEach((state, idx) => {
      const day = idx + 1
      if (state.active) {
        if (currentStart === null) {
          currentStart = day
        }
      } else {
        if (currentStart !== null) {
          blocks.push({ startDay: currentStart, endDay: day - 1 })
          currentStart = null
        }
      }
    })

    if (currentStart !== null) {
      blocks.push({ startDay: currentStart, endDay: dayStates.length })
    }

    return blocks
  }

  const activeBlocks = getActiveBlocks()

  const handleCellClick = (day: number) => {
    const nextStates = dayStates.map((state) =>
      state.day === day ? { ...state, active: !state.active } : state
    )
    onStatesChange(nextStates)
  }

  const handleHandleMouseDown = (
    e: React.MouseEvent,
    blockIndex: number,
    type: 'left' | 'right',
    originalStartDay: number,
    originalEndDay: number
  ) => {
    e.preventDefault()
    e.stopPropagation()
    setDraggingHandle({
      blockIndex,
      type,
      originalStartDay,
      originalEndDay,
    })
  }

  useEffect(() => {
    if (!draggingHandle) return

    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      
      const colWidth = rect.width / dayStates.length
      const currentDay = Math.max(1, Math.min(dayStates.length, Math.floor(x / colWidth) + 1))

      const { type, originalStartDay, originalEndDay } = draggingHandle

      const nextStates = [...dayStates]

      if (type === 'left') {
        const newStart = Math.min(currentDay, originalEndDay)
        for (let d = 1; d <= dayStates.length; d++) {
          if (d >= newStart && d <= originalEndDay) {
            nextStates[d - 1] = { ...nextStates[d - 1], active: true }
          } else if (d >= originalStartDay && d < newStart) {
            nextStates[d - 1] = { ...nextStates[d - 1], active: false }
          }
        }
      } else {
        const newEnd = Math.max(currentDay, originalStartDay)
        for (let d = 1; d <= dayStates.length; d++) {
          if (d >= originalStartDay && d <= newEnd) {
            nextStates[d - 1] = { ...nextStates[d - 1], active: true }
          } else if (d > newEnd && d <= originalEndDay) {
            nextStates[d - 1] = { ...nextStates[d - 1], active: false }
          }
        }
      }

      onStatesChange(nextStates)
    }

    const handleWindowMouseUp = () => {
      setDraggingHandle(null)
    }

    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }
  }, [draggingHandle, dayStates, onStatesChange])

  return (
    <div className="mb-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2">
        <div>
          <h4 className="font-semibold text-foreground text-sm sm:text-base">Lịch bật đèn</h4>
          <p className="text-xs text-muted-foreground">Chạm vào từng ngày để bật hoặc tắt đèn. Kéo hai đầu vùng màu vàng để thay đổi số ngày.</p>
        </div>
        
        {/* Dynamic biological phases display */}
        <div className="flex flex-wrap gap-2 text-[10px] md:text-xs">
          <div className="flex items-center gap-1.5 bg-amber-500/10 border border-amber-500/30 px-2 py-1 rounded text-amber-300">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span>Giai đoạn ủ tơ: <strong>Ngày 1 - {spawnRunningEndDay}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 rounded text-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>Giai đoạn ra nấm: <strong>Ngày {spawnRunningEndDay + 1} - {totalCropDays}</strong></span>
          </div>
        </div>
      </div>

      {/* Video-Editor-Style Timeline Track with Dynamic CSS Grid */}
      <div className="w-full bg-slate-900/40 border border-slate-700/60 rounded-lg p-1.5 md:p-3 overflow-x-auto">
        <div
          ref={containerRef}
          className="relative grid h-14 bg-slate-955/60 rounded border border-slate-800/80 select-none overflow-hidden"
          style={{ 
            gridTemplateColumns: `repeat(${dayStates.length}, minmax(0, 1fr))`,
            minWidth: `${dayStates.length * 30}px` 
          }}
        >
          {dayStates.map((state, idx) => {
            const day = idx + 1
            const isStart = state.active && (idx === 0 || !dayStates[idx - 1].active)
            const isEnd = state.active && (idx === dayStates.length - 1 || !dayStates[idx + 1].active)
            const blockIndex = activeBlocks.findIndex((b) => day >= b.startDay && day <= b.endDay)
            const block = activeBlocks[blockIndex]

            return (
              <div
                key={`day-col-${day}`}
                className={`relative flex flex-col items-center justify-center cursor-pointer border-r border-slate-800/40 last:border-r-0 transition-colors duration-150 ${
                  state.active
                    ? 'bg-amber-500/10 hover:bg-amber-500/20'
                    : 'bg-slate-900/30 hover:bg-slate-850/40'
                }`}
                onClick={() => handleCellClick(day)}
              >
                {state.active && (
                  <div className="absolute inset-y-0 inset-x-0 bg-amber-500/25 border-y border-amber-500/50 shadow-[inset_0_0_8px_rgba(245,158,11,0.25)] z-0" />
                )}

                {isStart && block && (
                  <div
                    className="absolute left-0 top-0 bottom-0 w-3 bg-amber-500 hover:bg-amber-400 cursor-ew-resize flex items-center justify-center rounded-l z-20 shadow-[0_0_6px_rgba(245,158,11,0.5)] border-r border-amber-600/30"
                    onMouseDown={(e) =>
                      handleHandleMouseDown(e, blockIndex, 'left', block.startDay, block.endDay)
                    }
                  >
                    <div className="w-0.5 h-4 bg-amber-900/90 rounded-full" />
                  </div>
                )}

                {isEnd && block && (
                  <div
                    className="absolute right-0 top-0 bottom-0 w-3 bg-amber-500 hover:bg-amber-400 cursor-ew-resize flex items-center justify-center rounded-r z-20 shadow-[0_0_6px_rgba(245,158,11,0.5)] border-l border-amber-600/30"
                    onMouseDown={(e) =>
                      handleHandleMouseDown(e, blockIndex, 'right', block.startDay, block.endDay)
                    }
                  >
                    <div className="w-0.5 h-4 bg-amber-900/90 rounded-full" />
                  </div>
                )}

                <span className={`text-[10px] font-medium z-10 ${state.active ? 'text-amber-200' : 'text-slate-500'}`}>
                  N.{day}
                </span>
                <span className={`text-[9px] font-bold z-10 mt-0.5 ${state.active ? 'text-amber-300' : 'text-slate-600'}`}>
                  {state.active ? 'Bật' : 'Tắt'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {activeBlocks.length > 0 && (
        <div className="mt-3 p-2.5 rounded bg-slate-955/40 border border-amber-500/20">
          <p className="text-xs text-muted-foreground flex flex-wrap gap-1.5 items-center">
            <span className="text-amber-400 font-semibold">Lịch bật đèn:</span>
            {activeBlocks.map((block, idx) => (
              <span key={idx} className="bg-amber-950/40 border border-amber-900/50 px-2 py-0.5 rounded text-amber-200 font-medium text-[11px] inline-block">
                Ngày {block.startDay}–{block.endDay} (Bật đèn)
              </span>
            ))}
          </p>
        </div>
      )}
    </div>
  )
}

export function FuzzyLogicEqualizer() {
  const {
    profileName,
    setProfileName,
    temperatureCheckpoints,
    setTemperatureCheckpoints,
    humidityCheckpoints,
    setHumidityCheckpoints,
    lightDayStates,
    setLightDayStates,
    tempOptimalRange,
    setTempOptimalRange,
    humidityOptimalRange,
    setHumidityOptimalRange,
    spawnRunningEndDay,
    totalCropDays,
    activeBatchId,
    saveAsNewProfile,
  } = useBatch()
  const { selectedDeviceId } = useSelectedDevice()
  const { middayBlackoutActive } = useRealTelemetry()

  const [initialCheckpoints, setInitialCheckpoints] = useState<{
    temperature: Checkpoint[]
    humidity: Checkpoint[]
  } | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Reset initial checkpoints when active batch ID changes
  useEffect(() => {
    setInitialCheckpoints(null)
  }, [activeBatchId])

  // Synchronize initial checkpoints from Context state on first load
  useEffect(() => {
    if (activeBatchId && !initialCheckpoints) {
      setInitialCheckpoints({
        temperature: [...temperatureCheckpoints],
        humidity: [...humidityCheckpoints],
      })
    }
  }, [activeBatchId, temperatureCheckpoints, humidityCheckpoints, initialCheckpoints])

  // Automatically dismiss toast after 3 seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500)
      return () => clearTimeout(timer)
    }
  }, [toast])

  const isDirty = useMemo(() => {
    if (!initialCheckpoints) return false

    // Compare temperatureCheckpoints length and values
    if (temperatureCheckpoints.length !== initialCheckpoints.temperature.length) return true
    for (let i = 0; i < temperatureCheckpoints.length; i++) {
      if (
        temperatureCheckpoints[i].day !== initialCheckpoints.temperature[i].day ||
        temperatureCheckpoints[i].value !== initialCheckpoints.temperature[i].value
      ) {
        return true
      }
    }

    // Compare humidityCheckpoints length and values
    if (humidityCheckpoints.length !== initialCheckpoints.humidity.length) return true
    for (let i = 0; i < humidityCheckpoints.length; i++) {
      if (
        humidityCheckpoints[i].day !== initialCheckpoints.humidity[i].day ||
        humidityCheckpoints[i].value !== initialCheckpoints.humidity[i].value
      ) {
        return true
      }
    }

    return false
  }, [temperatureCheckpoints, humidityCheckpoints, initialCheckpoints])

  const handleSaveChanges = async () => {
    if (!activeBatchId || isSaving || !isDirty) return
    setIsSaving(true)
    try {
      const tempInputs: CheckpointInput[] = temperatureCheckpoints.map((cp) => ({
        metricType: 'TEMPERATURE',
        cropDay: cp.day,
        targetValue: cp.value,
      }))
      const humInputs: CheckpointInput[] = humidityCheckpoints.map((cp) => ({
        metricType: 'HUMIDITY',
        cropDay: cp.day,
        targetValue: cp.value,
      }))
      const allCheckpoints = [...tempInputs, ...humInputs]

      await updateBatchCheckpoints(activeBatchId, allCheckpoints)

      setInitialCheckpoints({
        temperature: [...temperatureCheckpoints],
        humidity: [...humidityCheckpoints],
      })

      if (!selectedDeviceId) {
        setToast({ message: 'Đã lưu checkpoints. Hãy chọn thiết bị để đồng bộ crop profile.', type: 'success' })
        return
      }

      // A crop-profile command contains paired temperature/humidity checkpoints
      // for every crop day and clears any legacy direct baseline on the device.
      const humidityByDay = new Map(humidityCheckpoints.map((cp) => [cp.day, cp.value]))
      const checkpoints = temperatureCheckpoints.map((temperature) => ({
        cropDay: temperature.day,
        temperatureCelsius: temperature.value,
        humidityPercent: humidityByDay.get(temperature.day) ?? humidityCheckpoints[0]?.value,
      }))
      if (checkpoints.some((checkpoint) => checkpoint.humidityPercent === undefined)) {
        throw new Error('Mỗi checkpoint nhiệt độ phải có checkpoint độ ẩm cùng ngày để đồng bộ thiết bị.')
      }

      setIsSyncing(true)
      const sync = await postApplyCropProfile(selectedDeviceId, {
        cropStartEpochSec: Math.floor(Date.now() / 1000),
        totalCropDays,
        checkpoints: checkpoints as Array<{ cropDay: number; temperatureCelsius: number; humidityPercent: number }>,
      })
      if (!sync.success) throw new Error(sync.message)
      setToast({ message: 'Đã lưu. Đang đồng bộ profile xuống thiết bị; chờ ACK và telemetry xác nhận.', type: 'success' })
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Không thể lưu thay đổi checkpoints.',
        type: 'error',
      })
    } finally {
      setIsSaving(false)
      setIsSyncing(false)
    }
  }

  const lightBlocks = useMemo<LightTimelineBlock[]>(() => {
    const blocks: LightTimelineBlock[] = []
    if (lightDayStates.length === 0) return blocks

    let currentStatus: 'ON' | 'OFF' = lightDayStates[0].active ? 'ON' : 'OFF'
    let startDay = 1

    for (let i = 1; i <= lightDayStates.length; i++) {
      const dayState = lightDayStates[i - 1]
      const status: 'ON' | 'OFF' = dayState.active ? 'ON' : 'OFF'

      if (status !== currentStatus) {
        blocks.push({
          id: `light-block-${startDay}-${i - 1}`,
          startDay,
          endDay: i - 1,
          status: currentStatus,
        })
        startDay = i
        currentStatus = status
      }

      if (i === lightDayStates.length) {
        blocks.push({
          id: `light-block-${startDay}-${i}`,
          startDay,
          endDay: i,
          status: currentStatus,
        })
      }
    }
    return blocks
  }, [lightDayStates])

  const handleLightStatesChange = (newStates: DayTrack[]) => {
    setLightDayStates(newStates)
  }



  return (
    <Card className="p-4 md:p-6 border border-slate-700/50 bg-slate-950/40 col-span-full mt-6">
      <div className="mb-6">
        <h2 className="text-lg md:text-2xl font-bold text-foreground mb-4">
          Thiết lập điều kiện trồng (chu kỳ {lightDayStates.length} ngày)
        </h2>

        {/* Profile Name & Saving Options */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6 p-3 md:p-4 rounded-lg bg-slate-900/30 border border-slate-700/50">
          <input
            type="text"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="Tên hồ sơ"
            className="flex-1 w-full px-3 py-2 rounded bg-slate-800/50 border border-slate-700 text-foreground placeholder-muted-foreground focus:outline-none focus:border-emerald-500/50 text-xs sm:text-sm"
          />
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <Button
              onClick={() => {
                if (!profileName.trim()) {
                  setToast({ message: 'Vui lòng điền tên hồ sơ trước khi lưu!', type: 'error' })
                  return
                }
                saveAsNewProfile(profileName)
                setToast({ message: `Đã lưu hồ sơ "${profileName}" thành công!`, type: 'success' })
              }}
              className="bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 font-semibold transition-all px-4 py-2 text-xs sm:text-sm h-9 md:h-10 rounded-md flex items-center justify-center gap-2"
            >
              <span>Lưu thành hồ sơ mới</span>
            </Button>
            {activeBatchId ? (
              <Button
                onClick={handleSaveChanges}
                disabled={!isDirty || isSaving || isSyncing}
                className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold transition-all shadow-md shadow-emerald-950/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 px-4 py-2 text-xs sm:text-sm h-9 md:h-10 rounded-md"
              >
                {isSaving || isSyncing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>{isSyncing ? 'Đang đồng bộ...' : 'Đang lưu...'}</span>
                  </>
                ) : (
                  <span>Lưu thay đổi vụ đang chạy</span>
                )}
              </Button>
            ) : (
              <span className="self-center text-[10px] text-slate-500 uppercase font-bold tracking-wider px-2">
                Các thay đổi sẽ áp dụng khi bắt đầu vụ mới
              </span>
            )}
          </div>
        </div>

        {/* Edge-authoritative hard safety interlock */}
        <div className={`p-4 rounded-lg border mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
          middayBlackoutActive === true
            ? 'border-red-500/50 bg-red-950/30'
            : middayBlackoutActive === false
              ? 'border-emerald-500/30 bg-emerald-950/15'
              : 'border-slate-700/50 bg-slate-900/20'
        }`}>
          <div className="flex items-center gap-3">
            <AlertCircle className={`w-5.5 h-5.5 shrink-0 ${middayBlackoutActive === true ? 'text-red-400' : 'text-amber-400'}`} />
            <div className="flex flex-col gap-1.5">
              <h4 className="font-semibold text-foreground text-xs sm:text-sm">Khóa an toàn tại ESP32</h4>
              <p className="text-[10px] sm:text-xs text-muted-foreground">
                11:00–13:30 (Asia/Ho_Chi_Minh): Mist và gia nhiệt nước bị tắt; không thể thay đổi từ ứng dụng.
              </p>
            </div>
          </div>
          <div className={`flex items-center gap-2 text-[11px] font-semibold ${
            middayBlackoutActive === true ? 'text-red-300 animate-pulse' :
            middayBlackoutActive === false ? 'text-emerald-300' : 'text-slate-400'
          }`}>
            <Lock className="w-4 h-4" />
            <span>{middayBlackoutActive === true
              ? 'Đang trong giờ cấm — kích hoạt bởi Edge'
              : middayBlackoutActive === false
                ? 'ESP32 đang giám sát — ngoài giờ cấm'
                : 'Chưa xác minh từ ESP32'}</span>
          </div>
        </div>
      </div>

      {/* Three Parallel Timelines */}
      <div className="space-y-8">
        <Timeline
          title="Nhiệt độ mong muốn theo ngày"
          min={20}
          max={40}
          unit="°C"
          checkpoints={temperatureCheckpoints}
          onCheckpointChange={setTemperatureCheckpoints}
          optimalRange={tempOptimalRange}
          onOptimalRangeChange={setTempOptimalRange}
          isCurve
        />

        <Timeline
          title="Độ ẩm mong muốn theo ngày"
          min={50}
          max={100}
          unit="%"
          checkpoints={humidityCheckpoints}
          onCheckpointChange={setHumidityCheckpoints}
          optimalRange={humidityOptimalRange}
          onOptimalRangeChange={setHumidityOptimalRange}
          isCurve
        />

        <LightSchedule
          dayStates={lightDayStates}
          onStatesChange={handleLightStatesChange}
        />
      </div>

      {/* Info Section */}
      <div className="mt-6 p-4 rounded-lg bg-blue-950/20 border border-blue-500/20">
        <p className="text-xs text-blue-300">
          <Lightbulb className="w-3.5 h-3.5 inline-block align-text-bottom mr-1" />
          <strong>Gợi ý cho nấm rơm:</strong> Trong chu kỳ {totalCropDays} ngày, nấm được ủ tơ đến hết ngày {spawnRunningEndDay}.
          Từ ngày {spawnRunningEndDay + 1}, nấm chuyển sang giai đoạn ra nấm. Bạn có thể điều chỉnh nhiệt độ, độ ẩm và lịch bật đèn phù hợp với thực tế nhà nấm.
        </p>
      </div>

      {/* Toast Notification */}
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
          <span className="text-xs sm:text-sm font-medium">{toast.message}</span>
        </div>
      )}
    </Card>
  )
}
