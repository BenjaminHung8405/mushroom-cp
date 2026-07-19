'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Droplets, Lightbulb, LoaderCircle } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { useSelectedDevice } from '@/lib/selected-device-context'
import { useRealTelemetry } from '@/lib/real-telemetry-context'
import {
  fetchOfflineMonitoringHistory,
  type OfflineMonitoringPoint,
} from '@/lib/offline-monitoring-api'
import { downsampleByTime, hasRelayChattering } from '@/lib/timeseries'
import { SystemHealthCard } from './system-health-card'

const MAX_RENDERED_POINTS = 720
const RANGE_MS = 24 * 60 * 60 * 1000
const DEGRADED_MESSAGE = 'Dữ liệu được nội suy ước lượng do sự cố mất điện'

type ChartPoint = OfflineMonitoringPoint & { ms: number; x: number }
type Scale = { min: number; max: number; y: (point: ChartPoint) => number | null }

function makeChartPoints(
  points: OfflineMonitoringPoint[],
  rangeStart: number,
  rangeEnd: number,
): ChartPoint[] {
  const valid = points
    .map((point) => ({ ...point, ms: new Date(point.time).getTime() }))
    .filter((point) => Number.isFinite(point.ms))
    .sort((a, b) => a.ms - b.ms)
  const sampled = downsampleByTime(valid, MAX_RENDERED_POINTS, (point) => point.ms)
  const span = Math.max(1, rangeEnd - rangeStart)

  return sampled.map((point) => ({
    ...point,
    x: Math.min(100, Math.max(0, ((point.ms - rangeStart) / span) * 100)),
  }))
}

function scale(
  points: ChartPoint[],
  value: (point: ChartPoint) => number | null,
): Scale {
  const values = points
    .map(value)
    .filter((item): item is number => item !== null && Number.isFinite(item))
  const min = values.length ? Math.min(...values) : 0
  const max = Math.max(values.length ? Math.max(...values) : 1, min + 1)

  return {
    min,
    max,
    y: (point) => {
      const number = value(point)
      return number === null || !Number.isFinite(number)
        ? null
        : 92 - ((number - min) / (max - min)) * 84
    },
  }
}

/** Creates separate SVG subpaths, so a degraded/missing interval is never bridged. */
function pathFor(
  points: ChartPoint[],
  y: (point: ChartPoint) => number | null,
  quality: OfflineMonitoringPoint['dataQuality'],
) {
  let joinedPrevious = false
  return points
    .map((point) => {
      const vertical = y(point)
      const canJoin = point.dataQuality === quality && vertical !== null
      const segment = canJoin
        ? `${joinedPrevious ? 'L' : 'M'} ${point.x.toFixed(2)} ${vertical.toFixed(2)}`
        : ''
      joinedPrevious = canJoin
      return segment
    })
    .filter(Boolean)
    .join(' ')
}

function FuzzyDemandLine({
  points,
  getValue,
  stroke,
  label,
}: {
  points: ChartPoint[]
  getValue: (point: ChartPoint) => number | null
  stroke: string
  label: string
}) {
  const hasValues = points.some((point) => getValue(point) !== null)
  if (!hasValues) return null
  const view = scale(points, getValue)

  return (
    <>
      <path
        d={pathFor(points, view.y, 'trusted')}
        fill="none"
        stroke={stroke}
        strokeWidth="0.7"
        strokeDasharray="3 2"
        opacity="0.7"
      >
        <title>{label}</title>
      </path>
      <path
        d={pathFor(points, view.y, 'degraded')}
        fill="none"
        stroke="#facc15"
        strokeWidth="0.7"
        strokeDasharray="2 2"
      >
        <title>{DEGRADED_MESSAGE}</title>
      </path>
    </>
  )
}

function MicroclimateChart({ points, rangeStart, rangeEnd }: {
  points: ChartPoint[]
  rangeStart: number
  rangeEnd: number
}) {
  const temperature = scale(points, (point) => point.temperature)
  const humidity = scale(points, (point) => point.humidity)
  const hasFuzzyDemand = points.some(
    (point) => point.fuzzyTempDemand !== null || point.fuzzyHumidDemand !== null,
  )

  return (
    <Card className="col-span-1 border border-slate-700/60 bg-slate-950/50 p-5 md:col-span-2">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Vi khí hậu &amp; Fuzzy Demand</h3>
          <p className="text-xs text-slate-400">Nhiệt độ, độ ẩm và nhu cầu lý thuyết theo cùng một trục thời gian.</p>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
          <span className="text-orange-400">● Nhiệt độ</span>
          <span className="text-cyan-400">● Độ ẩm</span>
          <span>┄ Fuzzy demand</span>
          <span className="text-amber-400">┄ Nội suy</span>
        </div>
      </div>
      {!points.length ? <EmptyChart /> : <>
        <div className="relative h-72 rounded-lg border border-slate-800 bg-slate-950/70 p-2">
          <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Biểu đồ vi khí hậu">
            {[20, 40, 60, 80].map((value) => <line key={value} x1="0" x2="100" y1={value} y2={value} stroke="#334155" strokeWidth="0.25" />)}
            <path d={pathFor(points, temperature.y, 'trusted')} fill="none" stroke="#fb923c" strokeWidth="1.1"><title>Nhiệt độ đáng tin cậy</title></path>
            <path d={pathFor(points, temperature.y, 'degraded')} fill="none" stroke="#f59e0b" strokeWidth="1.1" strokeDasharray="2.5 1.6"><title>{DEGRADED_MESSAGE}</title></path>
            <path d={pathFor(points, humidity.y, 'trusted')} fill="none" stroke="#22d3ee" strokeWidth="1.1"><title>Độ ẩm đáng tin cậy</title></path>
            <path d={pathFor(points, humidity.y, 'degraded')} fill="none" stroke="#facc15" strokeWidth="1.1" strokeDasharray="2.5 1.6"><title>{DEGRADED_MESSAGE}</title></path>
            <FuzzyDemandLine points={points} getValue={(point) => point.fuzzyTempDemand} stroke="#fb923c" label="Fuzzy temperature demand" />
            <FuzzyDemandLine points={points} getValue={(point) => point.fuzzyHumidDemand} stroke="#22d3ee" label="Fuzzy humidity demand" />
          </svg>
          <div className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-orange-300">T: {temperature.min.toFixed(1)}–{temperature.max.toFixed(1)}°C</div>
          <div className="pointer-events-none absolute right-3 top-2 text-[10px] text-cyan-300">RH: {humidity.min.toFixed(1)}–{humidity.max.toFixed(1)}%</div>
        </div>
        <TimeAxis rangeStart={rangeStart} rangeEnd={rangeEnd} />
        <p className="mt-3 text-[11px] text-slate-500">{hasFuzzyDemand ? 'Fuzzy demand là đường nét đứt mờ; dữ liệu nội suy dùng nét đứt vàng.' : 'Chưa có dữ liệu Fuzzy Demand được ghi từ Edge. Dữ liệu nội suy dùng nét đứt vàng.'}</p>
      </>}
    </Card>
  )
}

function ActuatorTimeline({ rawPoints, rangeStart, rangeEnd }: {
  rawPoints: OfflineMonitoringPoint[]
  rangeStart: number
  rangeEnd: number
}) {
  const relayPoints = rawPoints
    .map((point) => ({ ...point, ms: new Date(point.time).getTime() }))
    .filter((point) => Number.isFinite(point.ms))
    .sort((a, b) => a.ms - b.ms)
  const mistChatter = hasRelayChattering(relayPoints, 'mistState')
  const lampChatter = hasRelayChattering(relayPoints, 'lampState')
  const chatter = mistChatter || lampChatter
  const timelineSpan = Math.max(1, rangeEnd - rangeStart)
  const toX = (ms: number) => Math.min(100, Math.max(0, ((ms - rangeStart) / timelineSpan) * 100))
  const row = (field: 'mistState' | 'lampState', color: string) => relayPoints.map((point, index) => {
    const next = relayPoints[index + 1]
    if (point[field] !== true) return null
    const x = toX(point.ms)
    const width = Math.max(0.15, toX(next?.ms ?? rangeEnd) - x)
    return <rect key={`${field}-${point.ms}`} x={x} y={field === 'mistState' ? 17 : 60} width={width} height="22" rx="1" fill={color} opacity={point.dataQuality === 'degraded' ? 0.5 : 0.95}><title>{point.dataQuality === 'degraded' ? DEGRADED_MESSAGE : 'Relay ON'}</title></rect>
  })

  return (
    <Card className="col-span-1 border border-slate-700/60 bg-slate-950/50 p-5 md:col-span-2">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h3 className="font-semibold">Timeline trạng thái thiết bị</h3><p className="text-xs text-slate-400">Trục thời gian đồng bộ hoàn toàn với biểu đồ vi khí hậu.</p></div>
        {chatter ? <span className="flex items-center gap-1 rounded-full border border-red-500/60 bg-red-950/70 px-2 py-1 text-[11px] font-semibold text-red-300"><AlertTriangle className="h-3.5 w-3.5" /> {mistChatter && lampChatter ? 'Mist và lamp chattering' : mistChatter ? 'Mist chattering' : 'Lamp chattering'} &gt;5/10 phút</span> : null}
      </div>
      {!relayPoints.length ? <EmptyChart /> : <>
        <div className="h-32 rounded-lg border border-slate-800 bg-slate-950/70 p-2"><svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Timeline trạng thái bơm phun sương và đèn"><text x="1" y="13" fill="#94a3b8" fontSize="7">Mist</text><text x="1" y="56" fill="#94a3b8" fontSize="7">Lamp</text><line x1="0" x2="100" y1="49" y2="49" stroke="#334155" strokeWidth="0.4" />{row('mistState', '#14b8a6')}{row('lampState', '#f59e0b')}</svg></div>
        <TimeAxis rangeStart={rangeStart} rangeEnd={rangeEnd} />
      </>}
      <div className="mt-3 flex gap-4 text-[11px] text-slate-400"><span><Droplets className="mr-1 inline h-3.5 w-3.5 text-teal-400" />Mist ON</span><span><Lightbulb className="mr-1 inline h-3.5 w-3.5 text-amber-400" />Lamp ON</span></div>
    </Card>
  )
}

function TimeAxis({ rangeStart, rangeEnd }: { rangeStart: number; rangeEnd: number }) {
  const format = (value: number) => new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(value)
  return <div className="mt-1 flex justify-between px-1 text-[10px] text-slate-500"><span>{format(rangeStart)}</span><span>{format(rangeStart + (rangeEnd - rangeStart) / 2)}</span><span>{format(rangeEnd)}</span></div>
}

function EmptyChart() {
  return <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-slate-700 text-sm text-slate-500">Chưa có dữ liệu InfluxDB trong 24 giờ đã chọn.</div>
}

export function OfflineMonitoringDashboard() {
  const { selectedDeviceId } = useSelectedDevice()
  const { deviceStatus } = useRealTelemetry()
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
          setHistoryError(error instanceof Error ? error.message : 'Không thể tải lịch sử InfluxDB.')
        }
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [selectedDeviceId])

  const chartPoints = useMemo(
    () => makeChartPoints(points, range.start, range.end),
    [points, range],
  )
  const latest = chartPoints.at(-1) ?? null

  return <>
    {loading ? <div className="col-span-1 flex items-center gap-2 text-xs text-slate-400 md:col-span-2"><LoaderCircle className="h-4 w-4 animate-spin" /> Đang tải dữ liệu InfluxDB…</div> : null}
    {historyError ? <div className="col-span-1 rounded-lg border border-red-500/50 bg-red-950/30 px-4 py-3 text-sm text-red-200 md:col-span-2">{historyError} Biểu đồ chưa thể xác nhận trạng thái dữ liệu.</div> : null}
    <SystemHealthCard latestPoint={latest} status={deviceStatus} />
    <MicroclimateChart points={chartPoints} rangeStart={range.start} rangeEnd={range.end} />
    <ActuatorTimeline rawPoints={points} rangeStart={range.start} rangeEnd={range.end} />
  </>
}
