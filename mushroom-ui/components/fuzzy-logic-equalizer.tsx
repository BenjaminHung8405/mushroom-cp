'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { useSimulation, Checkpoint, DayTrack } from '@/lib/simulation-context'
import { LightTimelineBlock } from '@/lib/types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Save, Copy, Lock, Unlock, AlertCircle } from 'lucide-react'

interface TimelineProps {
  title: string
  min: number
  max: number
  unit: string
  checkpoints: Checkpoint[]
  onCheckpointChange: (checkpoints: Checkpoint[]) => void
  isCurve?: boolean
  optimalRange?: [number, number]
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
}: TimelineProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [tooltip, setTooltip] = useState<{
    x: number
    y: number
    text: string
  } | null>(null)
  const [hoveredDay, setHoveredDay] = useState<number | null>(null)
  const [isTouch, setIsTouch] = useState(false)

  // Responsive canvas dimensions - initialized with defaults to avoid hydration mismatch
  const [canvasDimensions, setCanvasDimensions] = useState({
    CANVAS_WIDTH: 800,
    CANVAS_HEIGHT: 200,
    PADDING: 40,
  })

  // Update dimensions after mount based on actual window size
  useEffect(() => {
    const updateDimensions = () => {
      const width = Math.min(window.innerWidth - 48, 800) // 48px for padding
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
  const GRID_WIDTH = (CANVAS_WIDTH - PADDING * 2) / 21

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
    return Math.max(1, Math.min(21, dayIndex + 1))
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

    // Dragging existing node
    if (draggingIndex !== null) {
      const checkpoint = checkpoints[draggingIndex]
      // Prevent horizontal movement of anchor nodes (Day 1 and Day 21)
      if (checkpoint.day !== 1 && checkpoint.day !== 21) {
        // Allow full dragging for intermediate nodes
        let newValue = yToValue(y)
        newValue = snapToGrid(newValue, min, max)

        const newCheckpoints = [...checkpoints]
        newCheckpoints[draggingIndex] = {
          ...newCheckpoints[draggingIndex],
          value: newValue,
        }

        setTooltip({
          x,
          y: y - 20,
          text: `Magnetic Snap to ${newValue.toFixed(1)}${unit}`,
        })

        onCheckpointChange(newCheckpoints)
      } else {
        // For anchor nodes, only allow vertical adjustment
        let newValue = yToValue(y)
        newValue = snapToGrid(newValue, min, max)

        const newCheckpoints = [...checkpoints]
        newCheckpoints[draggingIndex] = {
          ...newCheckpoints[draggingIndex],
          value: newValue,
        }

        setTooltip({
          x,
          y: y - 20,
          text: `Locked Day - Value: ${newValue.toFixed(1)}${unit}`,
        })

        onCheckpointChange(newCheckpoints)
      }
    } else {
      // Hovering for add node feedback
      if (x > PADDING && x < CANVAS_WIDTH - PADDING) {
        setHoveredDay(xToDay(x))
      } else {
        setHoveredDay(null)
      }
    }
  }

  const handleMouseUp = () => {
    setDraggingIndex(null)
    setTooltip(null)
  }

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return

    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (x < PADDING || x > CANVAS_WIDTH - PADDING) return

    const day = xToDay(x)
    const value = snapToGrid(yToValue(y), min, max)

    // Check if node already exists at this day
    const existingIndex = checkpoints.findIndex((cp) => cp.day === day)
    if (existingIndex !== -1) return

    // Add new checkpoint
    const newCheckpoints = [...checkpoints, { day, value }].sort((a, b) => a.day - b.day)
    onCheckpointChange(newCheckpoints)

    setTooltip({
      x,
      y: y - 20,
      text: `Added ${value.toFixed(1)}${unit} at Day ${day}`,
    })

    setTimeout(() => setTooltip(null), 2000)
  }

  const handleNodeDoubleClick = (index: number) => {
    const checkpoint = checkpoints[index]
    // Prevent deletion of Day 1 and Day 21 (locked anchor points)
    if (checkpoint.day === 1 || checkpoint.day === 21) return

    const newCheckpoints = checkpoints.filter((_, i) => i !== index)
    onCheckpointChange(newCheckpoints)
  }

  // Global mouse up listener for dragging
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (draggingIndex !== null) {
        setDraggingIndex(null)
        setTooltip(null)
      }
    }

    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [draggingIndex])

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-foreground">{title}</h4>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Range: {min}-{max}{unit}
          </span>
          {optimalRange && (
            <span className="text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-400">
              Optimal: {optimalRange[0]}-{optimalRange[1]}{unit}
            </span>
          )}
        </div>
      </div>

      <div
        ref={canvasRef}
        className="relative w-full bg-slate-900/30 border border-slate-700/50 rounded-lg overflow-hidden"
        style={{ height: CANVAS_HEIGHT, userSelect: 'none', cursor: hoveredDay ? 'crosshair' : 'default' }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          handleMouseUp()
          setHoveredDay(null)
        }}
      >
        {/* Click Overlay for Adding Nodes */}
        <div
          ref={overlayRef}
          className="absolute inset-0"
          style={{ zIndex: 5 }}
          onClick={handleOverlayClick}
        />

        {/* SVG Grid and Curve */}
        <svg
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="absolute inset-0"
          style={{ pointerEvents: 'none' }}
        >
          {/* Vertical Gridlines (Days) */}
          {Array.from({ length: 21 }).map((_, i) => (
            <g key={`vgrid-${i}`}>
              <line
                x1={dayToX(i + 1)}
                y1={PADDING}
                x2={dayToX(i + 1)}
                y2={CANVAS_HEIGHT - PADDING}
                stroke="rgba(255,255,255,0.05)"
                strokeWidth="1"
              />
              <text
                x={dayToX(i + 1)}
                y={CANVAS_HEIGHT - PADDING + 20}
                fontSize="10"
                fill="rgba(255,255,255,0.4)"
                textAnchor="middle"
              >
                {i + 1}
              </text>
            </g>
          ))}

          {/* Horizontal Gridlines (Values) */}
          {Array.from({ length: (max - min) / 0.5 + 1 }).map((_, i) => {
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
              />
            )
          })}

          {/* Axis Labels */}
          <text x="10" y={valueToY(max)} fontSize="10" fill="rgba(255,255,255,0.5)">
            {max}{unit}
          </text>
          <text x="10" y={valueToY(min) + 10} fontSize="10" fill="rgba(255,255,255,0.5)">
            {min}{unit}
          </text>

          {/* Optimal Range Highlight (if applicable) */}
          {optimalRange && isCurve && (
            <rect
              x={PADDING}
              y={valueToY(optimalRange[1])}
              width={CANVAS_WIDTH - PADDING * 2}
              height={valueToY(optimalRange[0]) - valueToY(optimalRange[1])}
              fill="rgba(16, 185, 129, 0.1)"
              stroke="rgba(16, 185, 129, 0.3)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          )}

          {/* Curve / Line Connection */}
          {isCurve && checkpoints.length > 1 && (
            <polyline
              points={checkpoints
                .map((cp) => `${dayToX(cp.day)},${valueToY(cp.value)}`)
                .join(' ')}
              fill="none"
              stroke="rgba(16, 185, 129, 0.6)"
              strokeWidth="2"
            />
          )}

          {/* Checkpoint Nodes with Touch-Friendly Hitboxes */}
          {checkpoints.map((cp, idx) => (
            <g key={`node-${idx}`}>
              {/* Invisible 24px hitbox for touch targets */}
              <circle
                cx={dayToX(cp.day)}
                cy={valueToY(cp.value)}
                r="24"
                fill="transparent"
                style={{ pointerEvents: 'auto', cursor: 'grab' }}
                onMouseDown={() => handleNodeMouseDown(idx)}
                onDoubleClick={() => handleNodeDoubleClick(idx)}
              />
              {/* Visible node dot */}
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
                pointerEvents="none"
              >
                {cp.value.toFixed(1)}{unit}
              </text>
            </g>
          ))}

          {/* Add Node Indicator Cursor */}
          {hoveredDay && draggingIndex === null && (
            <text
              x={dayToX(hoveredDay)}
              y={PADDING - 10}
              fontSize="16"
              fill="rgba(16, 185, 129, 0.7)"
              textAnchor="middle"
              pointerEvents="none"
            >
              +
            </text>
          )}
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="absolute bg-slate-900 border border-emerald-500/50 px-2 py-1 rounded text-xs text-emerald-300 whitespace-nowrap z-10"
            style={{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }}
          >
            {tooltip.text}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground mt-2">
        💡 <strong>Click</strong> chart to add nodes (snap to 0.5). <strong>Drag</strong> nodes to adjust. <strong>Double-click</strong> intermediate nodes to delete (Day 1 &amp; 21 are locked).
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
  const [draggingHandle, setDraggingHandle] = useState<{
    blockIndex: number
    type: 'left' | 'right'
    originalStartDay: number
    originalEndDay: number
  } | null>(null)

  // Find all continuous active blocks
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
      blocks.push({ startDay: currentStart, endDay: 21 })
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
      
      // Calculate column width dynamically
      const colWidth = rect.width / 21
      const currentDay = Math.max(1, Math.min(21, Math.floor(x / colWidth) + 1))

      const { type, originalStartDay, originalEndDay } = draggingHandle

      const nextStates = [...dayStates]

      if (type === 'left') {
        // Dragging left boundary: new start day
        // Must clamp new start day to be <= originalEndDay
        const newStart = Math.min(currentDay, originalEndDay)
        
        for (let d = 1; d <= 21; d++) {
          if (d >= newStart && d <= originalEndDay) {
            nextStates[d - 1] = { ...nextStates[d - 1], active: true }
          } else if (d >= originalStartDay && d < newStart) {
            nextStates[d - 1] = { ...nextStates[d - 1], active: false }
          }
        }
      } else {
        // Dragging right boundary: new end day
        // Must clamp new end day to be >= originalStartDay
        const newEnd = Math.max(currentDay, originalStartDay)
        
        for (let d = 1; d <= 21; d++) {
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
      <div className="flex items-center justify-between mb-3 md:mb-4">
        <div>
          <h4 className="font-semibold text-foreground mb-1 text-sm md:text-base">Light Schedule (ON/OFF)</h4>
          <p className="text-xs text-muted-foreground">Click column to toggle • Drag amber boundaries to stretch/shrink block</p>
        </div>
      </div>

      {/* Video-Editor-Style Timeline Track */}
      <div className="w-full bg-slate-900/40 border border-slate-700/60 rounded-lg p-1.5 md:p-3 overflow-x-auto">
        <div
          ref={containerRef}
          className="relative flex h-14 min-w-[640px] md:min-w-0 bg-slate-955/60 rounded border border-slate-800/80 select-none overflow-hidden"
        >
          {dayStates.map((state, idx) => {
            const day = idx + 1
            const isStart = state.active && (idx === 0 || !dayStates[idx - 1].active)
            const isEnd = state.active && (idx === 20 || !dayStates[idx + 1].active)
            const blockIndex = activeBlocks.findIndex((b) => day >= b.startDay && day <= b.endDay)
            const block = activeBlocks[blockIndex]

            return (
              <div
                key={`day-col-${day}`}
                className={`relative flex-1 flex flex-col items-center justify-center cursor-pointer border-r border-slate-800/40 last:border-r-0 transition-colors duration-150 ${
                  state.active
                    ? 'bg-amber-500/10 hover:bg-amber-500/20'
                    : 'bg-slate-900/30 hover:bg-slate-850/40'
                }`}
                onClick={() => handleCellClick(day)}
              >
                {/* Visual Active Block Fill */}
                {state.active && (
                  <div className="absolute inset-y-0 inset-x-0 bg-amber-500/20 border-y border-amber-500/45 shadow-[inset_0_0_8px_rgba(245,158,11,0.15)] z-0" />
                )}

                {/* Left Drag Handle */}
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

                {/* Right Drag Handle */}
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

                {/* Day Labels */}
                <span className={`text-[10px] font-medium z-10 ${state.active ? 'text-amber-200' : 'text-slate-500'}`}>
                  D{day}
                </span>
                <span className={`text-[11px] font-bold z-10 mt-0.5 ${state.active ? 'text-amber-300' : 'text-slate-600'}`}>
                  {state.active ? 'ON' : 'OFF'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Active Block Info */}
      {activeBlocks.length > 0 && (
        <div className="mt-3 p-2.5 rounded bg-slate-950/40 border border-amber-500/20">
          <p className="text-xs text-muted-foreground">
            <span className="text-amber-400 font-semibold">Active Timeline Blocks:</span>{' '}
            {activeBlocks.map((block, idx) => (
              <span key={idx} className="bg-amber-955/40 border border-amber-900/50 px-2 py-0.5 rounded text-amber-200 font-medium text-[11px] inline-block mr-1.5">
                Day {block.startDay}–{block.endDay} (ON)
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
    thermalShockProtection,
    setThermalShockProtection,
    temperatureCheckpoints,
    setTemperatureCheckpoints,
    humidityCheckpoints,
    setHumidityCheckpoints,
    lightDayStates,
    setLightDayStates,
  } = useSimulation()

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

  const handleSaveProfile = () => {
    console.log('Profile saved:', {
      profileName,
      thermalShockProtection,
      temperatureCheckpoints,
      humidityCheckpoints,
      lightBlocks,
    })
  }

  const handleDistributeProfile = () => {
    console.log('Profile distributed to all farm houses')
  }

  return (
    <Card className="p-6 border border-slate-700/50 bg-slate-950/40 col-span-full mt-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-4">
          Fuzzy Logic Growth Profile Editor (21-Day Cycle)
        </h2>

        {/* Profile Saver Topbar - Responsive stacked on mobile */}
        <div className="flex flex-col md:flex-row gap-3 mb-6 p-3 md:p-4 rounded-lg bg-slate-900/30 border border-slate-700/50">
          <input
            type="text"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="Profile name"
            className="flex-1 w-full px-3 py-2 rounded bg-slate-800/50 border border-slate-700 text-foreground placeholder-muted-foreground focus:outline-none focus:border-emerald-500/50 text-sm md:text-base"
          />
          <div className="flex gap-2 w-full md:w-auto">
            <Button onClick={handleSaveProfile} className="gap-2 flex-1 md:flex-initial text-xs md:text-sm">
              <Save className="w-4 h-4" />
              <span className="hidden sm:inline">Save</span>
            </Button>
            <Button onClick={handleDistributeProfile} variant="outline" className="gap-2 flex-1 md:flex-initial text-xs md:text-sm">
              <Copy className="w-4 h-4" />
              <span className="hidden sm:inline">Distribute</span>
            </Button>
          </div>
        </div>

        {/* Intraday Thermal Shock Protection */}
        <div
          className={`p-4 rounded-lg border mb-6 flex items-center justify-between ${
            thermalShockProtection
              ? 'border-amber-500/30 bg-amber-950/20'
              : 'border-slate-700/50 bg-slate-900/20'
          }`}
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400" />
            <div>
              <h4 className="font-semibold text-foreground">
                Misting Blackout Window
              </h4>
              <p className="text-xs text-muted-foreground">
                11:00 AM - 1:30 PM thermal shock protection (misting restricted)
              </p>
            </div>
          </div>
          <button
            onClick={() => setThermalShockProtection(!thermalShockProtection)}
            className="p-2 rounded-lg hover:bg-slate-700/30 transition-colors"
          >
            {thermalShockProtection ? (
              <Lock className="w-5 h-5 text-amber-400" />
            ) : (
              <Unlock className="w-5 h-5 text-slate-500" />
            )}
          </button>
        </div>
      </div>

      {/* Three Parallel Timelines */}
      <div className="space-y-8">
        <Timeline
          title="Temperature Curve (Substrate Control)"
          min={20}
          max={40}
          unit="°C"
          checkpoints={temperatureCheckpoints}
          onCheckpointChange={setTemperatureCheckpoints}
          optimalRange={[28, 35]}
          isCurve
        />

        <Timeline
          title="Humidity Curve (Environmental Control)"
          min={50}
          max={100}
          unit="%"
          checkpoints={humidityCheckpoints}
          onCheckpointChange={setHumidityCheckpoints}
          optimalRange={[70, 90]}
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
          💡 <strong>Straw Mushroom (Volvariella volvacea) Profile:</strong> This 21-day cycle editor
          allows precise control over environmental conditions from spawn inoculation through fruiting.
          Checkpoints snap to 0.5 increments for precise fuzzy logic control.
        </p>
      </div>
    </Card>
  )
}
