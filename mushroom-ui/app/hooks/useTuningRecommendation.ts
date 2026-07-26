'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface TuningConfigSnapshot {
  lamp_gain_scale: number
  mist_gain_scale: number
  mist_on_threshold: number
  mist_off_threshold: number
}

export interface KpiMetrics {
  deviceId: string
  windowStart: string
  windowEnd: string
  tempRmse: number
  humidRmse: number
  mistSwitchCountPerHour: number
  lampDutyCyclePercent: number
  lampAvgOnDurationSec: number
  overshootDurationSec: number
  undershootDurationSec: number
  dataCoveragePercent: number
  sampleCount: number
  configRevision: number | null
  dataQualityWarning: boolean
}

export interface TuningAdvisory {
  rulesetVersion: string
  currentConfig: TuningConfigSnapshot
  suggestedConfig: TuningConfigSnapshot
  delta: Partial<TuningConfigSnapshot>
  triggeredRules: string[]
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  expectedBenefit: string
  kpiSnapshot: KpiMetrics
  observationWindowRequired: boolean
}

export type TuningRecommendationBlockReason =
  | 'INSUFFICIENT_DATA'
  | 'DEVICE_OFFLINE'
  | 'NO_SUGGESTION'
  | 'CONFLICT'

export interface TuningRecommendationResponseDto {
  deviceId: string
  kpi: KpiMetrics | null
  currentConfig: TuningConfigSnapshot | null
  advisory: TuningAdvisory | null
  blockReason: TuningRecommendationBlockReason | null
  blockReasonDetail: string | null
  generatedAt: string
}

export interface UseTuningRecommendationResult {
  data: TuningRecommendationResponseDto | null
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

/**
 * Loads one advisory snapshot for the selected device. The hook deliberately
 * does not poll: advisory refreshes are initiated by mount, device changes, or
 * an explicit caller action.
 */
export function useTuningRecommendation(
  deviceId: string | null | undefined,
): UseTuningRecommendationResult {
  const [data, setData] = useState<TuningRecommendationResponseDto | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const activeRequestRef = useRef<AbortController | null>(null)

  const load = useCallback(async (): Promise<void> => {
    activeRequestRef.current?.abort()

    if (!deviceId) {
      activeRequestRef.current = null
      return
    }

    const controller = new AbortController()
    activeRequestRef.current = controller
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/backend/devices/${encodeURIComponent(deviceId)}/analytics/tuning-recommendations`,
        { cache: 'no-store', signal: controller.signal },
      )

      if (!response.ok) {
        throw new Error(
          `Không thể tải khuyến nghị tinh chỉnh (HTTP ${response.status}).`,
        )
      }

      const payload: unknown = await response.json()
      if (!controller.signal.aborted) {
        setData(payload as TuningRecommendationResponseDto)
      }
    } catch (cause: unknown) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error
            ? cause
            : new Error('Không thể tải khuyến nghị tinh chỉnh.'),
        )
      }
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }
  }, [deviceId])

  useEffect(() => {
    if (!deviceId) {
      activeRequestRef.current?.abort()
      activeRequestRef.current = null
      setData(null)
      setError(null)
      setIsLoading(false)
      return
    }

    void load()

    return () => {
      activeRequestRef.current?.abort()
      activeRequestRef.current = null
    }
  }, [deviceId, load])

  return { data, isLoading, error, refetch: load }
}
