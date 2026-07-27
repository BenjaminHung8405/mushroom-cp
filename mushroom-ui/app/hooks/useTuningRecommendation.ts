'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  parseTuningRecommendationResponse,
  type KpiMetrics,
  type TuningAdvisory,
  type TuningBlockReason,
  type TuningConfigSnapshot,
  type TuningRecommendationResponseDto,
} from '@/app/lib/tuning-schema'

export type {
  KpiMetrics,
  TuningAdvisory,
  TuningBlockReason,
  TuningBlockReason as TuningRecommendationBlockReason,
  TuningConfigSnapshot,
  TuningRecommendationResponseDto,
}

export interface UseTuningRecommendationResult {
  data: TuningRecommendationResponseDto | null
  isLoading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useTuningRecommendation(
  deviceId: string | null | undefined,
): UseTuningRecommendationResult {
  const [data, setData] = useState<TuningRecommendationResponseDto | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchAdvisory = useCallback(async () => {
    if (!deviceId) {
      setData(null)
      setIsLoading(false)
      setError(null)
      return
    }

    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/backend/devices/${encodeURIComponent(deviceId)}/analytics/tuning-recommendations`,
        {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        },
      )

      if (!response.ok) {
        throw new Error(
          `Không thể tải đề xuất tinh chỉnh (HTTP ${response.status}).`,
        )
      }

      const payload: unknown = await response.json()
      if (controller.signal.aborted) return

      const validated = parseTuningRecommendationResponse(payload, deviceId)
      if (!validated) {
        setData(null)
        setError(new Error('Máy chủ trả về dữ liệu đề xuất không hợp lệ.'))
      } else {
        setData(validated)
        setError(null)
      }
    } catch (cause: unknown) {
      if (controller.signal.aborted) return
      setData(null)
      setError(
        cause instanceof Error
          ? cause
          : new Error('Không thể tải đề xuất tinh chỉnh.'),
      )
    } finally {
      if (abortControllerRef.current === controller) {
        setIsLoading(false)
      }
    }
  }, [deviceId])

  useEffect(() => {
    void fetchAdvisory()

    return () => {
      abortControllerRef.current?.abort()
    }
  }, [fetchAdvisory])

  return {
    data,
    isLoading,
    error,
    refetch: fetchAdvisory,
  }
}
