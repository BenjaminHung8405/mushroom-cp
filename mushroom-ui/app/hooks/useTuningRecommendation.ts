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

export async function fetchAdvisoryFromApi(
  deviceId: string,
  signal: AbortSignal,
): Promise<TuningRecommendationResponseDto> {
  const response = await fetch(
    `/api/backend/devices/${encodeURIComponent(deviceId)}/analytics/tuning-recommendations`,
    {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal,
    },
  )

  if (!response.ok) {
    throw new Error(`Không thể tải đề xuất tinh chỉnh (HTTP ${response.status}).`)
  }

  const payload: unknown = await response.json()
  const validated = parseTuningRecommendationResponse(payload, deviceId)
  if (!validated) {
    throw new Error('Máy chủ trả về dữ liệu đề xuất không hợp lệ.')
  }
  return validated
}

function useAdvisoryFetcher(
  deviceId: string | null | undefined,
  setData: React.Dispatch<React.SetStateAction<TuningRecommendationResponseDto | null>>,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
  setError: React.Dispatch<React.SetStateAction<Error | null>>,
  abortControllerRef: React.MutableRefObject<AbortController | null>,
) {
  return useCallback(async () => {
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
      const validated = await fetchAdvisoryFromApi(deviceId, controller.signal)
      if (controller.signal.aborted || validated.deviceId !== deviceId) return
      setData(validated)
      setError(null)
    } catch (cause: unknown) {
      if (controller.signal.aborted) return
      setData(null)
      setError(cause instanceof Error ? cause : new Error('Không thể tải đề xuất tinh chỉnh.'))
    } finally {
      if (abortControllerRef.current === controller) {
        setIsLoading(false)
      }
    }
  }, [deviceId, setData, setIsLoading, setError, abortControllerRef])
}

export function useTuningRecommendation(
  deviceId: string | null | undefined,
): UseTuningRecommendationResult {
  const [data, setData] = useState<TuningRecommendationResponseDto | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)
  const fetchAdvisory = useAdvisoryFetcher(
    deviceId,
    setData,
    setIsLoading,
    setError,
    abortControllerRef,
  )

  useEffect(() => {
    void fetchAdvisory()
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [fetchAdvisory])

  const safeData = data && deviceId && data.deviceId === deviceId ? data : null

  return {
    data: safeData,
    isLoading: safeData ? false : isLoading,
    error: safeData ? null : error,
    refetch: fetchAdvisory,
  }
}
