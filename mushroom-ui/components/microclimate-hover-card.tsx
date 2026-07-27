'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Droplets, Lightbulb, Thermometer } from 'lucide-react'

import type { OfflineMonitoringPoint } from '@/lib/offline-monitoring-api'

export interface RawPoint extends OfflineMonitoringPoint {
  ms: number
}

export interface HoverCardProps {
  hoverTimeMs: number | null
  rawPoints: RawPoint[]
  tempOptimalRange: [number, number]
  humidityOptimalRange: [number, number]
  temperatureSetpoint: number | null
  humiditySetpoint: number | null
  operatingMode: 'AI' | 'MANUAL' | null
  latestSnapshotMs?: number
  latestDeltaTimeS?: number | null
  inDegradedInterval?: boolean
  chatteringInfo?: { count: number } | null
  anchorClientX: number | null
  anchorClientY: number | null
}

/** Finds the last known sample at-or-before the hovered timestamp. */
export function findNearestPoint(rawPoints: RawPoint[], hoverTimeMs: number | null): RawPoint | null {
  if (hoverTimeMs === null || rawPoints.length === 0) return null
  let best: RawPoint | null = null
  for (const point of rawPoints) {
    if (point.ms <= hoverTimeMs) {
      if (!best || point.ms > best.ms) best = point
    }
  }
  return best ?? rawPoints[0]
}

function chipStyle(
  value: number | null,
  optimal: [number, number],
  danger: [number, number],
): string {
  if (value === null || !Number.isFinite(value)) return 'border-slate-700 text-slate-300'
  if (value < danger[0] || value > danger[1]) return 'border-red-500/50 bg-red-500/10 text-red-200'
  if (value < optimal[0] || value > optimal[1]) return 'border-amber-500/50 bg-amber-500/10 text-amber-100'
  return 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100'
}

function formatTimeLabel(ms: number): string {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(ms)
}

function formatDateLabel(ms: number): string {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(ms)
}

export function MicroclimateHoverCard(props: HoverCardProps) {
  const {
    hoverTimeMs,
    rawPoints,
    tempOptimalRange,
    humidityOptimalRange,
    temperatureSetpoint,
    humiditySetpoint,
    operatingMode,
    latestSnapshotMs,
    latestDeltaTimeS,
    inDegradedInterval,
    chatteringInfo,
    anchorClientX,
    anchorClientY,
  } = props

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const nearest = useMemo(() => findNearestPoint(rawPoints, hoverTimeMs), [rawPoints, hoverTimeMs])

  if (!mounted || hoverTimeMs === null || anchorClientX === null || anchorClientY === null) {
    return null
  }

  const timestamp = nearest?.ms ?? hoverTimeMs
  const isDegraded = inDegradedInterval || nearest?.dataQuality === 'degraded'
  const isLatestSnapshot =
    latestSnapshotMs !== undefined && nearest !== null && nearest.ms === latestSnapshotMs
  const showRuntime = isLatestSnapshot && typeof latestDeltaTimeS === 'number' && Number.isFinite(latestDeltaTimeS)

  const temperatureChip = chipStyle(nearest?.temperature ?? null, tempOptimalRange, [20, 40])
  const humidityChip = chipStyle(nearest?.humidity ?? null, humidityOptimalRange, [60, 95])

  // Keep the card away from viewport edges (max card width ~ 320, height ~ 220).
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1024
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 768
  const cardW = 300
  const cardH = 220
  const x = Math.min(Math.max(12, anchorClientX + 16), viewportW - cardW - 12)
  const y = Math.min(Math.max(12, anchorClientY + 16), viewportH - cardH - 12)

  return createPortal(
    <div
      role="tooltip"
      aria-live="polite"
      className="pointer-events-none fixed z-50 min-w-[260px] max-w-[320px] rounded-lg border border-slate-700/60 bg-slate-950/85 p-3 text-xs text-slate-100 shadow-2xl backdrop-blur-md"
      style={{ left: x, top: y }}
    >
      <div className="flex items-center gap-2 text-[11px] text-slate-300">
        <span aria-hidden="true">🕒</span>
        <span className="font-mono">{formatTimeLabel(timestamp)}</span>
        <span className="text-slate-500">•</span>
        <span>{formatDateLabel(timestamp)}</span>
      </div>

      <div className="mt-3 space-y-1.5 border-t border-slate-800/70 pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-slate-300">
            <Thermometer className="size-3.5 text-orange-400" aria-hidden="true" /> Nhiệt độ
          </span>
          <span className="flex items-center gap-2">
            <span className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${temperatureChip}`}>
              {nearest?.temperature !== null && nearest?.temperature !== undefined
                ? `${nearest.temperature.toFixed(1)}°C`
                : '—'}
            </span>
            {temperatureSetpoint !== null && Number.isFinite(temperatureSetpoint) && (
              <span
                className="rounded border border-slate-700/70 px-1.5 py-0.5 text-[10px] text-slate-400"
                title="Setpoint — mức nhiệt độ mục tiêu cho hệ thống điều khiển."
              >
                Mục tiêu: {temperatureSetpoint.toFixed(1)}°C
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-slate-300">
            <Droplets className="size-3.5 text-cyan-400" aria-hidden="true" /> Độ ẩm
          </span>
          <span className="flex items-center gap-2">
            <span className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${humidityChip}`}>
              {nearest?.humidity !== null && nearest?.humidity !== undefined
                ? `${nearest.humidity.toFixed(1)}%`
                : '—'}
            </span>
            {humiditySetpoint !== null && Number.isFinite(humiditySetpoint) && (
              <span
                className="rounded border border-slate-700/70 px-1.5 py-0.5 text-[10px] text-slate-400"
                title="Setpoint — mức độ ẩm mục tiêu cho hệ thống điều khiển."
              >
                Mục tiêu: {humiditySetpoint.toFixed(1)}%
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="mt-3 space-y-1.5 border-t border-slate-800/70 pt-2">
        <p className="text-[10px] uppercase tracking-wider text-slate-500">Thiết bị lúc này</p>
        <DeviceStateRow
          Icon={Droplets}
          iconClassName="text-teal-400"
          label="Phun sương"
          active={nearest?.mistState ?? null}
          runtimeS={showRuntime && nearest?.mistState ? latestDeltaTimeS ?? null : null}
        />
        <DeviceStateRow
          Icon={Lightbulb}
          iconClassName="text-amber-400"
          label="Đèn sưởi"
          active={nearest?.lampState ?? null}
          runtimeS={showRuntime && nearest?.lampState ? latestDeltaTimeS ?? null : null}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-800/70 pt-2 text-[10px]">
        <span
          className="rounded border border-slate-700/70 px-1.5 py-0.5 text-slate-300"
          title="Chế độ vận hành hiện tại của thiết bị (không phải lịch sử tại điểm hover)."
        >
          Chế độ: {operatingMode === 'MANUAL' ? 'Thủ công' : operatingMode === 'AI' ? 'AI • Fuzzy' : 'Chưa xác định'}
        </span>
        {isDegraded && (
          <span className="rounded border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-amber-200">
            Dữ liệu ước lượng
          </span>
        )}
        {chatteringInfo && (
          <span className="rounded border border-red-500/50 bg-red-500/10 px-1.5 py-0.5 text-red-200">
            Rơ-le đóng ngắt {chatteringInfo.count} lần / 10 phút
          </span>
        )}
      </div>
    </div>,
    document.body,
  )
}

function DeviceStateRow({
  Icon,
  iconClassName,
  label,
  active,
  runtimeS,
}: {
  Icon: typeof Droplets
  iconClassName: string
  label: string
  active: boolean | null
  runtimeS: number | null
}) {
  const statusLabel = active === null ? 'Không rõ' : active ? 'Đang bật' : 'Đang tắt'
  const dot = active === null
    ? 'bg-slate-500'
    : active
      ? 'bg-emerald-400'
      : 'bg-slate-600'
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-slate-300">
        <Icon className={`size-3.5 ${iconClassName}`} aria-hidden="true" /> {label}
      </span>
      <span className="flex items-center gap-2">
        <span className={`inline-block size-1.5 rounded-full ${dot}`} aria-hidden="true" />
        <span className="text-[11px] text-slate-200">
          {statusLabel}
          {runtimeS !== null && Number.isFinite(runtimeS) && (
            <span className="ml-1 text-slate-400">(đã chạy {Math.round(runtimeS)}s)</span>
          )}
        </span>
      </span>
    </div>
  )
}
