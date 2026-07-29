'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  fetchOfflineMonitoringHistory,
  type OfflineMonitoringPoint,
} from '@/lib/offline-monitoring-api'
import {
  detectChatteringWindows,
  type ChatteringWindow,
  type RelayField,
} from '@/lib/timeseries'

const RANGE_MS = 24 * 60 * 60 * 1_000

export interface OperationalHistoryRange {
  start: number
  end: number
}

export interface OperationalHistorySummary {
  totalPoints: number
  trustedPoints: number
  latestTime: string | null
  latestQuality: OfflineMonitoringPoint['dataQuality'] | null
  chattering: Array<ChatteringWindow & { field: RelayField }>
}

export interface OperationalHistoryState {
  points: OfflineMonitoringPoint[]
  loading: boolean
  error: string | null
  range: OperationalHistoryRange
  summary: OperationalHistorySummary
}

interface CacheEntry {
  range: OperationalHistoryRange
  promise: Promise<OfflineMonitoringPoint[]> | null
  points: OfflineMonitoringPoint[] | null
  error: string | null
}

const historyCache = new Map<string, CacheEntry>()

export function emptyOperationalHistorySummary(): OperationalHistorySummary {
  return {
    totalPoints: 0,
    trustedPoints: 0,
    latestTime: null,
    latestQuality: null,
    chattering: [],
  }
}

export function summarizeOperationalHistory(points: OfflineMonitoringPoint[]): OperationalHistorySummary {
  const valid = points
    .map((point) => ({ ...point, ms: new Date(point.time).getTime() }))
    .filter((point) => Number.isFinite(point.ms))
    .sort((a, b) => a.ms - b.ms)
  const relayPoints = valid.map((point) => ({
    ms: point.ms,
    mistState: point.mistState,
    lampState: point.lampState,
    dataQuality: point.dataQuality,
  }))

  return {
    totalPoints: valid.length,
    trustedPoints: valid.filter((point) => point.dataQuality === 'trusted').length,
    latestTime: valid.at(-1)?.time ?? null,
    latestQuality: valid.at(-1)?.dataQuality ?? null,
    chattering: [
      ...detectChatteringWindows(relayPoints, 'mistState').map((window) => ({ ...window, field: 'mistState' as const })),
      ...detectChatteringWindows(relayPoints, 'lampState').map((window) => ({ ...window, field: 'lampState' as const })),
    ].sort((a, b) => b.endMs - a.endMs),
  }
}

function createHistoryEntry(deviceId: string): CacheEntry {
  const end = Date.now()
  const range = { start: end - RANGE_MS, end }
  const entry: CacheEntry = { range, promise: null, points: null, error: null }
  entry.promise = fetchOfflineMonitoringHistory(deviceId, new Date(range.start), new Date(range.end))
    .then((points) => {
      entry.points = points
      return points
    })
    .catch((error: unknown) => {
      entry.error = error instanceof Error ? error.message : 'Không thể tải lịch sử vi khí hậu.'
      throw error
    })
  historyCache.set(deviceId, entry)
  return entry
}

/**
 * Fetches the lightweight 24-hour source once per device per session. The
 * detailed charts receive this state later, avoiding an additional request
 * and remaining completely unmounted while their section is closed.
 */
export function useOperationalHistory(deviceId: string | null): OperationalHistoryState {
  const initialRange = useMemo(() => {
    const end = Date.now()
    return { start: end - RANGE_MS, end }
  }, [])
  const [state, setState] = useState<OperationalHistoryState>({
    points: [], loading: Boolean(deviceId), error: null, range: initialRange, summary: emptyOperationalHistorySummary(),
  })

  useEffect(() => {
    if (!deviceId) {
      setState((current) => ({ ...current, points: [], loading: false, error: null, summary: emptyOperationalHistorySummary() }))
      return
    }

    const entry = historyCache.get(deviceId) ?? createHistoryEntry(deviceId)
    if (entry.points !== null) {
      setState({ points: entry.points, loading: false, error: null, range: entry.range, summary: summarizeOperationalHistory(entry.points) })
      return
    }
    if (entry.error !== null) {
      setState({ points: [], loading: false, error: entry.error, range: entry.range, summary: emptyOperationalHistorySummary() })
      return
    }

    let cancelled = false
    setState({ points: [], loading: true, error: null, range: entry.range, summary: emptyOperationalHistorySummary() })
    void entry.promise?.then((points) => {
      if (!cancelled) setState({ points, loading: false, error: null, range: entry.range, summary: summarizeOperationalHistory(points) })
    }).catch(() => {
      if (!cancelled) setState({ points: [], loading: false, error: entry.error ?? 'Không thể tải lịch sử vi khí hậu.', range: entry.range, summary: emptyOperationalHistorySummary() })
    })
    return () => { cancelled = true }
  }, [deviceId])

  return state
}
