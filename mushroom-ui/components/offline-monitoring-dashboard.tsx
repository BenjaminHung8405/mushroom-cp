'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Droplets,
  Lightbulb,
  LoaderCircle,
} from 'lucide-react'

import { Card } from '@/components/ui/card'
import { useSelectedDevice } from '@/lib/selected-device-context'
import { useRealTelemetry } from '@/lib/real-telemetry-context'
import { useBatch } from '@/lib/batch-context'
import {
  fetchOfflineMonitoringHistory,
  type OfflineMonitoringPoint,
} from '@/lib/offline-monitoring-api'
import {
  computeDegradedIntervals,
  detectChatteringWindows,
  downsampleByTime,
  type ChatteringWindow,
  type DegradedInterval,
} from '@/lib/timeseries'
import {
  ScrubberProvider,
  pointerToTimeMs,
  timeToX,
  useScrubber,
} from '@/components/microclimate-scrubber-context'
import {
  MicroclimateHoverCard,
  type RawPoint,
} from '@/components/microclimate-hover-card'
import { SystemHealthCard } from './system-health-card'

const MAX_RENDERED_POINTS = 720
const RANGE_MS = 24 * 60 * 60 * 1000
const TEMP_AXIS = { min: 20, max: 40 } // °C
const HUM_AXIS = { min: 50, max: 100 } // %

type ChartPoint = OfflineMonitoringPoint & { ms: number; x: number }

function buildRawPoints(points: OfflineMonitoringPoint[]): RawPoint[] {
  return points
    .map((point) => ({ ...point, ms: new Date(point.time).getTime() }))
    .filter((point) => Number.isFinite(point.ms))
    .sort((a, b) => a.ms - b.ms)
}

function makeChartPoints(
  raw: RawPoint[],
  rangeStart: number,
  rangeEnd: number,
): ChartPoint[] {
  const sampled = downsampleByTime(raw, MAX_RENDERED_POINTS, (point) => point.ms)
  const span = Math.max(1, rangeEnd - rangeStart)
  return sampled.map((point) => ({
    ...point,
    x: Math.min(100, Math.max(0, ((point.ms - rangeStart) / span) * 100)),
  }))
}

// Fixed y-mappers so temperature and humidity share a consistent 0..100 chart
// area. Reserving 8..92 leaves room for axis labels above and below.
function yFromTemperature(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const clamped = Math.max(TEMP_AXIS.min, Math.min(TEMP_AXIS.max, value))
  return 92 - ((clamped - TEMP_AXIS.min) / (TEMP_AXIS.max - TEMP_AXIS.min)) * 84
}

function yFromHumidity(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const clamped = Math.max(HUM_AXIS.min, Math.min(HUM_AXIS.max, value))
  return 92 - ((clamped - HUM_AXIS.min) / (HUM_AXIS.max - HUM_AXIS.min)) * 84
}

function yFromFuzzy(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null
  const clamped = Math.max(0, Math.min(1, value))
  return 92 - clamped * 84
}

/** Splits by data quality so degraded segments render separately. */
function pathFor(
  points: ChartPoint[],
  y: (point: ChartPoint) => number | null,
  quality: OfflineMonitoringPoint['dataQuality'],
): string {
  let joinedPrevious = false
  const segments: string[] = []
  for (const point of points) {
    const vertical = y(point)
    const canJoin = point.dataQuality === quality && vertical !== null
    if (canJoin) {
      segments.push(
        `${joinedPrevious ? 'L' : 'M'} ${point.x.toFixed(2)} ${vertical.toFixed(2)}`,
      )
    }
    joinedPrevious = canJoin
  }
  return segments.join(' ')
}

function formatHour(ms: number): string {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(ms)
}

function EmptyChart({ label = 'Chưa có dữ liệu 24 giờ.' }: { label?: string }) {
  return (
    <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-700 text-sm text-slate-500">
      {label}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Time axis
// ---------------------------------------------------------------------------

function TimeAxis({ rangeStart, rangeEnd }: { rangeStart: number; rangeEnd: number }) {
  const majorMarks = useMemo(() => {
    const step = (rangeEnd - rangeStart) / 4
    return Array.from({ length: 5 }, (_, index) => rangeStart + index * step)
  }, [rangeStart, rangeEnd])

  const minorTicks = useMemo(() => {
    const step = (rangeEnd - rangeStart) / 8 // every 3h across a 24h window
    return Array.from({ length: 9 }, (_, index) => rangeStart + index * step)
  }, [rangeStart, rangeEnd])

  return (
    <div className="relative mt-1 h-6 px-1 text-[10px] text-slate-500">
      <div className="relative h-2 border-t border-slate-800/60">
        {minorTicks.map((ms) => (
          <span
            key={`tick-${ms}`}
            className="absolute top-0 h-1 w-px bg-slate-700/60"
            style={{
              left: `${timeToX(ms, rangeStart, rangeEnd)}%`,
            }}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="relative">
        {majorMarks.map((ms, index) => (
          <span
            key={`label-${ms}`}
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{
              left: `${timeToX(ms, rangeStart, rangeEnd)}%`,
              transform:
                index === 0
                  ? 'translateX(0)'
                  : index === majorMarks.length - 1
                    ? 'translateX(-100%)'
                    : 'translateX(-50%)',
            }}
          >
            {formatHour(ms)}
          </span>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Microclimate chart
// ---------------------------------------------------------------------------

interface MicroclimateChartProps {
  chartPoints: ChartPoint[]
  rawPoints: RawPoint[]
  degradedIntervals: DegradedInterval[]
  rangeStart: number
  rangeEnd: number
  tempOptimalRange: [number, number]
  humidityOptimalRange: [number, number]
  temperatureSetpoint: number | null
  humiditySetpoint: number | null
  operatingMode: 'AI' | 'MANUAL' | null
  latestSnapshotMs: number | null
  latestDeltaTimeS: number | null
}

function tempOptimalRect(range: [number, number]) {
  const top = yFromTemperature(range[1]) ?? 8
  const bottom = yFromTemperature(range[0]) ?? 92
  return { y: top, height: Math.max(0, bottom - top) }
}

function humidityOptimalRect(range: [number, number]) {
  const top = yFromHumidity(range[1]) ?? 8
  const bottom = yFromHumidity(range[0]) ?? 92
  return { y: top, height: Math.max(0, bottom - top) }
}

interface PinMarker {
  key: string
  x: number
  y: number
  color: string
  title: string
}

function computePinMarkers(
  raw: RawPoint[],
  rangeStart: number,
  rangeEnd: number,
  tempOptimal: [number, number],
  humidityOptimal: [number, number],
): PinMarker[] {
  if (raw.length === 0) return []
  const [tempMin, tempMax] = tempOptimal
  const [humMin, humMax] = humidityOptimal
  let worstLowTemp: RawPoint | null = null
  let worstHighTemp: RawPoint | null = null
  let worstLowHum: RawPoint | null = null
  let worstHighHum: RawPoint | null = null

  for (const point of raw) {
    if (typeof point.temperature === 'number') {
      if (point.temperature < tempMin && (!worstLowTemp || point.temperature < (worstLowTemp.temperature ?? Infinity))) {
        worstLowTemp = point
      }
      if (point.temperature > tempMax && (!worstHighTemp || point.temperature > (worstHighTemp.temperature ?? -Infinity))) {
        worstHighTemp = point
      }
    }
    if (typeof point.humidity === 'number') {
      if (point.humidity < humMin && (!worstLowHum || point.humidity < (worstLowHum.humidity ?? Infinity))) {
        worstLowHum = point
      }
      if (point.humidity > humMax && (!worstHighHum || point.humidity > (worstHighHum.humidity ?? -Infinity))) {
        worstHighHum = point
      }
    }
  }

  const candidates: (PinMarker | null)[] = [
    worstLowTemp && {
      key: `low-temp-${worstLowTemp.ms}`,
      x: timeToX(worstLowTemp.ms, rangeStart, rangeEnd),
      y: yFromTemperature(worstLowTemp.temperature) ?? 92,
      color: '#f97316',
      title: `Nhiệt độ thấp: ${(worstLowTemp.temperature ?? 0).toFixed(1)}°C lúc ${formatHour(worstLowTemp.ms)}`,
    },
    worstHighTemp && {
      key: `high-temp-${worstHighTemp.ms}`,
      x: timeToX(worstHighTemp.ms, rangeStart, rangeEnd),
      y: yFromTemperature(worstHighTemp.temperature) ?? 8,
      color: '#f97316',
      title: `Nhiệt độ cao: ${(worstHighTemp.temperature ?? 0).toFixed(1)}°C lúc ${formatHour(worstHighTemp.ms)}`,
    },
    worstLowHum && {
      key: `low-hum-${worstLowHum.ms}`,
      x: timeToX(worstLowHum.ms, rangeStart, rangeEnd),
      y: yFromHumidity(worstLowHum.humidity) ?? 92,
      color: '#06b6d4',
      title: `Độ ẩm thấp: ${(worstLowHum.humidity ?? 0).toFixed(1)}% lúc ${formatHour(worstLowHum.ms)}`,
    },
    worstHighHum && {
      key: `high-hum-${worstHighHum.ms}`,
      x: timeToX(worstHighHum.ms, rangeStart, rangeEnd),
      y: yFromHumidity(worstHighHum.humidity) ?? 8,
      color: '#06b6d4',
      title: `Độ ẩm cao: ${(worstHighHum.humidity ?? 0).toFixed(1)}% lúc ${formatHour(worstHighHum.ms)}`,
    },
  ]

  const validPins = candidates.filter((pin): pin is PinMarker => pin !== null)
  return validPins.slice(0, 2)
}

function MicroclimateChart(props: MicroclimateChartProps) {
  const {
    chartPoints,
    rawPoints,
    degradedIntervals,
    rangeStart,
    rangeEnd,
    tempOptimalRange,
    humidityOptimalRange,
    temperatureSetpoint,
    humiditySetpoint,
    operatingMode,
    latestSnapshotMs,
    latestDeltaTimeS,
  } = props

  const scrubber = useScrubber()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)

  const hasFuzzyDemand = chartPoints.some(
    (point) =>
      (point.fuzzyTempDemand !== null && point.fuzzyTempDemand !== undefined) ||
      (point.fuzzyHumidDemand !== null && point.fuzzyHumidDemand !== undefined),
  )
  const isEmpty = chartPoints.length === 0

  const tempZone = useMemo(() => tempOptimalRect(tempOptimalRange), [tempOptimalRange])
  const humZone = useMemo(() => humidityOptimalRect(humidityOptimalRange), [humidityOptimalRange])
  const pins = useMemo(
    () => computePinMarkers(rawPoints, rangeStart, rangeEnd, tempOptimalRange, humidityOptimalRange),
    [rawPoints, rangeStart, rangeEnd, tempOptimalRange, humidityOptimalRange],
  )

  const hoverX =
    scrubber.hoverTimeMs !== null
      ? timeToX(scrubber.hoverTimeMs, rangeStart, rangeEnd)
      : null

  const inDegraded = useMemo(() => {
    if (scrubber.hoverTimeMs === null) return false
    return degradedIntervals.some(
      (interval) =>
        scrubber.hoverTimeMs !== null &&
        scrubber.hoverTimeMs >= interval.startMs &&
        scrubber.hoverTimeMs <= interval.endMs,
    )
  }, [scrubber.hoverTimeMs, degradedIntervals])

  const handlePointerMove = (event: React.PointerEvent<Element>) => {
    const ms = pointerToTimeMs(event, rangeStart, rangeEnd)
    if (ms === null) return
    scrubber.setHoverTimeMs(ms)
    setAnchor({ x: event.clientX, y: event.clientY })
  }
  const handlePointerLeave = () => {
    scrubber.setHoverTimeMs(null)
    setAnchor(null)
  }
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      scrubber.step(-5 * 60_000)
      event.preventDefault()
    } else if (event.key === 'ArrowRight') {
      scrubber.step(5 * 60_000)
      event.preventDefault()
    } else if (event.key === 'Home') {
      scrubber.setHoverTimeMs(rangeStart)
      event.preventDefault()
    } else if (event.key === 'End') {
      scrubber.setHoverTimeMs(rangeEnd)
      event.preventDefault()
    } else if (event.key === 'Escape') {
      scrubber.reset()
      event.preventDefault()
    }
  }

  return (
    <Card className="col-span-1 border border-slate-700/60 bg-slate-950/50 p-5 md:col-span-2">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Vi khí hậu 24 giờ</h3>
          <p className="text-xs text-slate-400">
            Nhiệt độ, độ ẩm và mức nhu cầu điều khiển trong 24 giờ.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
          <span className="text-orange-400">● Nhiệt độ</span>
          <span className="text-cyan-400">● Độ ẩm</span>
          <span
            className="text-slate-400"
            title="Fuzzy demand — mức nhu cầu điều khiển được hệ thống Fuzzy tính ra."
          >
            ┄ Nhu cầu điều khiển (Fuzzy)
          </span>
          <span className="inline-flex items-center gap-1 rounded border border-slate-700/60 px-1.5 py-0.5 text-slate-300">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-sm"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, rgba(148,163,184,0.6) 0 2px, transparent 2px 4px)',
              }}
            />
            Vùng dữ liệu ước lượng
          </span>
        </div>
      </div>
      {isEmpty ? (
        <EmptyChart label="Chưa có dữ liệu vi khí hậu trong 24 giờ đã chọn." />
      ) : (
        <>
          <div className="relative flex items-stretch gap-2">
            <YAxisLabels
              min={TEMP_AXIS.min}
              max={TEMP_AXIS.max}
              suffix="°C"
              className="text-orange-300/80"
              side="left"
            />
            <div
              ref={containerRef}
              tabIndex={0}
              role="img"
              aria-label="Biểu đồ vi khí hậu — dùng phím mũi tên để di chuyển con trỏ."
              onKeyDown={handleKeyDown}
              className="relative h-72 flex-1 rounded-lg border border-slate-800 bg-slate-950/70 p-2 outline-none focus-visible:ring-1 focus-visible:ring-cyan-500/60"
              style={{ touchAction: 'pan-y' }}
            >
              <svg
                className="h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <pattern
                    id="hatched-degraded"
                    width="4"
                    height="4"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <rect width="4" height="4" fill="transparent" />
                    <line x1="0" y1="0" x2="0" y2="4" stroke="#94a3b8" strokeWidth="1.2" opacity="0.35" />
                  </pattern>
                </defs>

                {/* Target zones */}
                <g style={{ mixBlendMode: 'screen' }}>
                  <rect
                    x="0"
                    y={tempZone.y}
                    width="100"
                    height={tempZone.height}
                    fill="#fb923c"
                    opacity="0.06"
                  />
                  <rect
                    x="0"
                    y={humZone.y}
                    width="100"
                    height={humZone.height}
                    fill="#22d3ee"
                    opacity="0.06"
                  />
                </g>

                {/* Horizontal grid only */}
                {[20, 40, 60, 80].map((value) => (
                  <line
                    key={value}
                    x1="0"
                    x2="100"
                    y1={value}
                    y2={value}
                    stroke="#334155"
                    strokeOpacity="0.35"
                    strokeWidth="0.25"
                  />
                ))}

                {/* Degraded intervals */}
                {degradedIntervals.map((interval) => {
                  const x1 = timeToX(interval.startMs, rangeStart, rangeEnd)
                  const x2 = timeToX(interval.endMs, rangeStart, rangeEnd)
                  const width = Math.max(0.4, x2 - x1)
                  return (
                    <rect
                      key={`degraded-${interval.startMs}`}
                      x={x1}
                      y="0"
                      width={width}
                      height="100"
                      fill="url(#hatched-degraded)"
                      opacity="0.6"
                    >
                      <title>Dữ liệu ước lượng do sự cố mất điện</title>
                    </rect>
                  )
                })}

                {/* Fuzzy demand — subtle dashed background */}
                {hasFuzzyDemand && (
                  <>
                    <path
                      d={pathFor(chartPoints, (point) => yFromFuzzy(point.fuzzyTempDemand), 'trusted')}
                      fill="none"
                      stroke="#fb923c"
                      strokeWidth="0.5"
                      strokeDasharray="2 2"
                      opacity="0.45"
                    />
                    <path
                      d={pathFor(chartPoints, (point) => yFromFuzzy(point.fuzzyHumidDemand), 'trusted')}
                      fill="none"
                      stroke="#22d3ee"
                      strokeWidth="0.5"
                      strokeDasharray="2 2"
                      opacity="0.45"
                    />
                  </>
                )}

                {/* Main series */}
                <path
                  d={pathFor(chartPoints, (point) => yFromTemperature(point.temperature), 'trusted')}
                  fill="none"
                  stroke="#fb923c"
                  strokeWidth="1.2"
                />
                <path
                  d={pathFor(chartPoints, (point) => yFromTemperature(point.temperature), 'degraded')}
                  fill="none"
                  stroke="#fb923c"
                  strokeWidth="1.2"
                  opacity="0.7"
                />
                <path
                  d={pathFor(chartPoints, (point) => yFromHumidity(point.humidity), 'trusted')}
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth="1.2"
                />
                <path
                  d={pathFor(chartPoints, (point) => yFromHumidity(point.humidity), 'degraded')}
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth="1.2"
                  opacity="0.7"
                />

                {/* Pin markers */}
                {pins.map((pin) => (
                  <g key={pin.key}>
                    <circle
                      cx={pin.x}
                      cy={pin.y}
                      r="1.6"
                      fill={pin.color}
                      stroke="#0f172a"
                      strokeWidth="0.4"
                    >
                      <title>{pin.title}</title>
                    </circle>
                  </g>
                ))}

                {/* Scrubber line */}
                {hoverX !== null && (
                  <line
                    x1={hoverX}
                    x2={hoverX}
                    y1="0"
                    y2="100"
                    stroke="#e2e8f0"
                    strokeOpacity="0.35"
                    strokeWidth="0.35"
                    strokeDasharray="1.5 1.5"
                  />
                )}

                {/* Pointer capture surface */}
                <rect
                  x="0"
                  y="0"
                  width="100"
                  height="100"
                  fill="transparent"
                  onPointerMove={handlePointerMove}
                  onPointerLeave={handlePointerLeave}
                  style={{ cursor: 'crosshair' }}
                />
              </svg>
            </div>
            <YAxisLabels
              min={HUM_AXIS.min}
              max={HUM_AXIS.max}
              suffix="%"
              className="text-cyan-300/80"
              side="right"
            />
          </div>
          <TimeAxis rangeStart={rangeStart} rangeEnd={rangeEnd} />
          {!hasFuzzyDemand && (
            <p className="mt-3 text-[11px] text-slate-500">
              Hệ thống chưa ghi được đường Nhu cầu điều khiển từ thiết bị.
            </p>
          )}
        </>
      )}

      <MicroclimateHoverCard
        hoverTimeMs={scrubber.hoverTimeMs}
        rawPoints={rawPoints}
        tempOptimalRange={tempOptimalRange}
        humidityOptimalRange={humidityOptimalRange}
        temperatureSetpoint={temperatureSetpoint}
        humiditySetpoint={humiditySetpoint}
        operatingMode={operatingMode}
        latestSnapshotMs={latestSnapshotMs ?? undefined}
        latestDeltaTimeS={latestDeltaTimeS ?? null}
        inDegradedInterval={inDegraded}
        anchorClientX={anchor?.x ?? null}
        anchorClientY={anchor?.y ?? null}
      />
    </Card>
  )
}

function YAxisLabels({
  min,
  max,
  suffix,
  className,
  side,
}: {
  min: number
  max: number
  suffix: string
  className: string
  side: 'left' | 'right'
}) {
  const ticks = [max, max - (max - min) * 0.25, (max + min) / 2, min + (max - min) * 0.25, min]
  return (
    <div
      className={`flex h-72 w-8 flex-col justify-between py-2 text-[10px] font-mono ${className} ${
        side === 'right' ? 'items-start' : 'items-end'
      }`}
      aria-hidden="true"
    >
      {ticks.map((tick) => (
        <span key={`${side}-${tick}`}>{`${tick}${suffix}`}</span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Actuator timeline
// ---------------------------------------------------------------------------

interface ActuatorTimelineProps {
  rawPoints: RawPoint[]
  degradedIntervals: DegradedInterval[]
  rangeStart: number
  rangeEnd: number
}

interface Segment {
  startMs: number
  endMs: number
  active: boolean
  degraded: boolean
}

function buildSegments(
  raw: RawPoint[],
  rangeStart: number,
  rangeEnd: number,
  field: 'mistState' | 'lampState',
): Segment[] {
  const points = raw.filter((point) => point[field] !== null)
  if (points.length === 0) return []
  const segments: Segment[] = []
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]
    const next = points[index + 1]
    const start = Math.max(point.ms, rangeStart)
    const end = Math.min(next?.ms ?? rangeEnd, rangeEnd)
    if (end <= start) continue
    segments.push({
      startMs: start,
      endMs: end,
      active: point[field] === true,
      degraded: point.dataQuality === 'degraded',
    })
  }
  // Merge adjacent same-state segments so the timeline reads as one block.
  const merged: Segment[] = []
  for (const segment of segments) {
    const last = merged[merged.length - 1]
    if (last && last.active === segment.active && last.degraded === segment.degraded && Math.abs(last.endMs - segment.startMs) < 5_000) {
      last.endMs = segment.endMs
    } else {
      merged.push({ ...segment })
    }
  }
  return merged
}

interface DutyBucket {
  startMs: number
  endMs: number
  ratio: number
}

function buildDutyBuckets(
  segments: Segment[],
  rangeStart: number,
  rangeEnd: number,
  bucketMs = 15 * 60_000,
): DutyBucket[] {
  const buckets: DutyBucket[] = []
  for (let cursor = rangeStart; cursor < rangeEnd; cursor += bucketMs) {
    const bucketEnd = Math.min(rangeEnd, cursor + bucketMs)
    let onMs = 0
    for (const segment of segments) {
      if (!segment.active) continue
      const overlapStart = Math.max(cursor, segment.startMs)
      const overlapEnd = Math.min(bucketEnd, segment.endMs)
      if (overlapEnd > overlapStart) onMs += overlapEnd - overlapStart
    }
    const ratio = onMs / (bucketEnd - cursor)
    buckets.push({ startMs: cursor, endMs: bucketEnd, ratio })
  }
  return buckets
}

function ActuatorTimeline(props: ActuatorTimelineProps) {
  const { rawPoints, degradedIntervals, rangeStart, rangeEnd } = props
  const scrubber = useScrubber()

  const mistSegments = useMemo(
    () => buildSegments(rawPoints, rangeStart, rangeEnd, 'mistState'),
    [rawPoints, rangeStart, rangeEnd],
  )
  const lampSegments = useMemo(
    () => buildSegments(rawPoints, rangeStart, rangeEnd, 'lampState'),
    [rawPoints, rangeStart, rangeEnd],
  )
  const mistDuty = useMemo(() => buildDutyBuckets(mistSegments, rangeStart, rangeEnd), [mistSegments, rangeStart, rangeEnd])
  const lampDuty = useMemo(() => buildDutyBuckets(lampSegments, rangeStart, rangeEnd), [lampSegments, rangeStart, rangeEnd])

  const chatteringPoints = useMemo(
    () => rawPoints.map((point) => ({ ms: point.ms, mistState: point.mistState, lampState: point.lampState, dataQuality: point.dataQuality })),
    [rawPoints],
  )
  const mistChattering = useMemo(
    () => detectChatteringWindows(chatteringPoints, 'mistState'),
    [chatteringPoints],
  )
  const lampChattering = useMemo(
    () => detectChatteringWindows(chatteringPoints, 'lampState'),
    [chatteringPoints],
  )
  const anyChattering = mistChattering.length + lampChattering.length > 0

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const [activeChatter, setActiveChatter] = useState<ChatteringWindow | null>(null)

  const handlePointerMove = (event: React.PointerEvent<Element>) => {
    const ms = pointerToTimeMs(event, rangeStart, rangeEnd)
    if (ms === null) return
    scrubber.setHoverTimeMs(ms)
    setAnchor({ x: event.clientX, y: event.clientY })
    const hit = [...mistChattering, ...lampChattering].find(
      (window) => ms >= window.startMs && ms <= window.endMs,
    )
    setActiveChatter(hit ?? null)
  }
  const handlePointerLeave = () => {
    scrubber.setHoverTimeMs(null)
    setAnchor(null)
    setActiveChatter(null)
  }

  const isEmpty = rawPoints.length === 0
  const hoverX =
    scrubber.hoverTimeMs !== null
      ? timeToX(scrubber.hoverTimeMs, rangeStart, rangeEnd)
      : null

  return (
    <Card className="col-span-1 border border-slate-700/60 bg-slate-950/50 p-5 md:col-span-2">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Lịch sử hoạt động thiết bị</h3>
          <p className="text-xs text-slate-400">
            Rê chuột trên biểu đồ trên để xem trạng thái tại cùng thời điểm.
          </p>
        </div>
        {anyChattering && (
          <span className="flex items-center gap-1 rounded-full border border-red-500/60 bg-red-950/70 px-2 py-1 text-[11px] font-semibold text-red-300">
            <AlertTriangle className="h-3.5 w-3.5" />
            Rơ-le đóng ngắt liên tục ({'>'}5 lần/10 phút)
          </span>
        )}
      </div>

      {isEmpty ? (
        <EmptyChart label="Chưa có dữ liệu hoạt động thiết bị trong 24 giờ." />
      ) : (
        <>
          <div className="relative flex gap-3">
            <div className="flex w-24 shrink-0 flex-col justify-around py-2 text-xs font-semibold text-slate-300">
              <span>Phun sương <span className="font-normal text-slate-500">(Mist)</span></span>
              <span>Đèn sưởi <span className="font-normal text-slate-500">(Lamp)</span></span>
            </div>
            <div
              ref={containerRef}
              className="relative h-32 flex-1 rounded-lg border border-slate-800 bg-slate-950/70 p-2"
              style={{ touchAction: 'pan-y' }}
            >
              <svg
                className="h-full w-full"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-label="Lịch sử bật/tắt phun sương và đèn sưởi"
              >
                <defs>
                  <pattern
                    id="degraded-actuator"
                    width="4"
                    height="4"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <line x1="0" y1="0" x2="0" y2="4" stroke="#94a3b8" strokeWidth="1.2" opacity="0.4" />
                  </pattern>
                  <pattern
                    id="chatter-overlay"
                    width="6"
                    height="6"
                    patternUnits="userSpaceOnUse"
                    patternTransform="rotate(45)"
                  >
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#ef4444" strokeWidth="1.5" opacity="0.35" />
                  </pattern>
                </defs>

                <ActuatorRow
                  yTop={6}
                  segments={mistSegments}
                  dutyBuckets={mistDuty}
                  color="#14b8a6"
                  rangeStart={rangeStart}
                  rangeEnd={rangeEnd}
                  chatterWindows={mistChattering}
                />
                <ActuatorRow
                  yTop={56}
                  segments={lampSegments}
                  dutyBuckets={lampDuty}
                  color="#f59e0b"
                  rangeStart={rangeStart}
                  rangeEnd={rangeEnd}
                  chatterWindows={lampChattering}
                />

                {/* Degraded overlay across both rows */}
                {degradedIntervals.map((interval) => {
                  const x1 = timeToX(interval.startMs, rangeStart, rangeEnd)
                  const x2 = timeToX(interval.endMs, rangeStart, rangeEnd)
                  const width = Math.max(0.4, x2 - x1)
                  return (
                    <rect
                      key={`degraded-timeline-${interval.startMs}`}
                      x={x1}
                      y="0"
                      width={width}
                      height="100"
                      fill="url(#degraded-actuator)"
                      opacity="0.45"
                    >
                      <title>Dữ liệu ước lượng</title>
                    </rect>
                  )
                })}

                {hoverX !== null && (
                  <line
                    x1={hoverX}
                    x2={hoverX}
                    y1="0"
                    y2="100"
                    stroke="#e2e8f0"
                    strokeOpacity="0.35"
                    strokeWidth="0.35"
                    strokeDasharray="1.5 1.5"
                  />
                )}

                <rect
                  x="0"
                  y="0"
                  width="100"
                  height="100"
                  fill="transparent"
                  onPointerMove={handlePointerMove}
                  onPointerLeave={handlePointerLeave}
                  style={{ cursor: 'crosshair' }}
                />
              </svg>
            </div>
          </div>
          <TimeAxis rangeStart={rangeStart} rangeEnd={rangeEnd} />

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
            <span><Droplets className="mr-1 inline h-3.5 w-3.5 text-teal-400" />Phun sương đang bật</span>
            <span><Lightbulb className="mr-1 inline h-3.5 w-3.5 text-amber-400" />Đèn sưởi đang bật</span>
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-sm"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(45deg, rgba(148,163,184,0.6) 0 2px, transparent 2px 4px)',
                }}
              />
              Dữ liệu ước lượng
            </span>
            <span className="inline-flex items-center gap-1">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-sm"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(45deg, rgba(239,68,68,0.6) 0 2px, transparent 2px 4px)',
                }}
              />
              Rơ-le đóng ngắt liên tục
            </span>
          </div>

          {activeChatter && anchor && (
            <ChatteringHint
              chatter={activeChatter}
              anchorX={anchor.x}
              anchorY={anchor.y}
            />
          )}
        </>
      )}
    </Card>
  )
}

function ActuatorRow({
  yTop,
  segments,
  dutyBuckets,
  color,
  rangeStart,
  rangeEnd,
  chatterWindows,
}: {
  yTop: number
  segments: Segment[]
  dutyBuckets: DutyBucket[]
  color: string
  rangeStart: number
  rangeEnd: number
  chatterWindows: ChatteringWindow[]
}) {
  const barY = yTop + 8
  const barHeight = 24
  return (
    <g>
      {/* Duty ribbon */}
      {dutyBuckets.map((bucket) => {
        if (bucket.ratio <= 0) return null
        const x = timeToX(bucket.startMs, rangeStart, rangeEnd)
        const width = Math.max(
          0.2,
          timeToX(bucket.endMs, rangeStart, rangeEnd) - x,
        )
        return (
          <rect
            key={`duty-${yTop}-${bucket.startMs}`}
            x={x}
            y={yTop}
            width={width}
            height={4}
            fill={color}
            opacity={0.15 + Math.min(0.6, bucket.ratio * 0.6)}
          >
            <title>{`Tỉ lệ bật: ${Math.round(bucket.ratio * 100)}%`}</title>
          </rect>
        )
      })}

      {/* ON segments */}
      {segments.map((segment) => {
        if (!segment.active) return null
        const x = timeToX(segment.startMs, rangeStart, rangeEnd)
        const width = Math.max(
          0.25,
          timeToX(segment.endMs, rangeStart, rangeEnd) - x,
        )
        return (
          <rect
            key={`on-${yTop}-${segment.startMs}`}
            x={x}
            y={barY}
            width={width}
            height={barHeight}
            rx="1"
            fill={segment.degraded ? 'url(#degraded-actuator)' : color}
            opacity={segment.degraded ? 0.85 : 0.95}
          >
            <title>{segment.degraded ? 'Dữ liệu ước lượng' : 'Đang bật'}</title>
          </rect>
        )
      })}

      {/* Chattering overlays */}
      {chatterWindows.map((chatter) => {
        const x = timeToX(chatter.startMs, rangeStart, rangeEnd)
        const width = Math.max(
          0.5,
          timeToX(chatter.endMs, rangeStart, rangeEnd) - x,
        )
        return (
          <rect
            key={`chatter-${yTop}-${chatter.startMs}`}
            x={x}
            y={yTop}
            width={width}
            height={barHeight + 8}
            fill="url(#chatter-overlay)"
            stroke="#ef4444"
            strokeWidth="0.4"
            strokeDasharray="1.5 1.5"
            opacity="0.75"
          >
            <title>{`Đóng ngắt ${chatter.count} lần trong 10 phút — Khuyến nghị tăng Deadband (ngưỡng chờ).`}</title>
          </rect>
        )
      })}
    </g>
  )
}

function ChatteringHint({
  chatter,
  anchorX,
  anchorY,
}: {
  chatter: ChatteringWindow
  anchorX: number
  anchorY: number
}) {
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768
  const width = 260
  const height = 84
  const x = Math.min(Math.max(12, anchorX + 16), viewportW - width - 12)
  const y = Math.min(Math.max(12, anchorY + 16), viewportH - height - 12)
  return (
    <div
      role="status"
      className="pointer-events-none fixed z-40 max-w-[280px] rounded-lg border border-red-500/50 bg-red-950/80 p-3 text-xs text-red-100 shadow-2xl backdrop-blur-md"
      style={{ left: x, top: y }}
    >
      <p className="font-semibold">Rơ-le đóng ngắt liên tục</p>
      <p className="mt-1 leading-5">
        Đóng ngắt {chatter.count} lần trong 10 phút. Khuyến nghị tăng Deadband (ngưỡng chờ) để rơ-le nghỉ lâu hơn.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Top-level wiring
// ---------------------------------------------------------------------------

export function OfflineMonitoringDashboard() {
  const { selectedDeviceId } = useSelectedDevice()
  const {
    deviceStatus,
    temperatureSetpoint,
    humiditySetpoint,
    operatingMode,
    snapshot,
  } = useRealTelemetry()
  const { tempOptimalRange, humidityOptimalRange } = useBatch()
  const [points, setPoints] = useState<OfflineMonitoringPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [range, setRange] = useState(() => {
    const end = Date.now()
    return { start: end - RANGE_MS, end }
  })

  useEffect(() => {
    if (!selectedDeviceId) {
      setPoints([])
      setLoading(false)
      setHistoryError(null)
      return
    }
    let cancelled = false
    const end = Date.now()
    const nextRange = { start: end - RANGE_MS, end }
    setRange(nextRange)
    setLoading(true)
    setHistoryError(null)
    fetchOfflineMonitoringHistory(selectedDeviceId, new Date(nextRange.start), new Date(nextRange.end))
      .then((next) => { if (!cancelled) setPoints(next) })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPoints([])
          setHistoryError(error instanceof Error ? error.message : 'Không thể tải lịch sử vi khí hậu.')
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedDeviceId])

  const rawPoints = useMemo(() => buildRawPoints(points), [points])
  const chartPoints = useMemo(
    () => makeChartPoints(rawPoints, range.start, range.end),
    [rawPoints, range],
  )
  const degradedIntervals = useMemo(
    () => computeDegradedIntervals(rawPoints),
    [rawPoints],
  )
  const latest = chartPoints.at(-1) ?? null
  const latestSnapshotMs = snapshot?.time ? new Date(snapshot.time).getTime() : null
  const latestDeltaTimeS = rawPoints.at(-1)?.deltaTimeS ?? null

  return (
    <ScrubberProvider rangeStart={range.start} rangeEnd={range.end}>
      {loading ? (
        <div className="col-span-1 flex items-center gap-2 text-xs text-slate-400 md:col-span-2">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Đang tải dữ liệu 24 giờ…
        </div>
      ) : null}
      {historyError ? (
        <div className="col-span-1 rounded-lg border border-red-500/50 bg-red-950/30 px-4 py-3 text-sm text-red-200 md:col-span-2">
          {historyError} Biểu đồ chưa thể xác nhận trạng thái dữ liệu.
        </div>
      ) : null}
      <SystemHealthCard latestPoint={latest} status={deviceStatus} />
      <MicroclimateChart
        chartPoints={chartPoints}
        rawPoints={rawPoints}
        degradedIntervals={degradedIntervals}
        rangeStart={range.start}
        rangeEnd={range.end}
        tempOptimalRange={tempOptimalRange}
        humidityOptimalRange={humidityOptimalRange}
        temperatureSetpoint={temperatureSetpoint}
        humiditySetpoint={humiditySetpoint}
        operatingMode={operatingMode}
        latestSnapshotMs={latestSnapshotMs}
        latestDeltaTimeS={latestDeltaTimeS}
      />
      <ActuatorTimeline
        rawPoints={rawPoints}
        degradedIntervals={degradedIntervals}
        rangeStart={range.start}
        rangeEnd={range.end}
      />
    </ScrubberProvider>
  )
}
