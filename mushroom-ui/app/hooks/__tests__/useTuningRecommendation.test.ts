import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTuningRecommendation } from '@/app/hooks/useTuningRecommendation'

describe('useTuningRecommendation hook', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null data and does not fetch when deviceId is null or undefined', async () => {
    const { result } = renderHook(() => useTuningRecommendation(null))
    expect(result.current.data).toBeNull()
    expect(result.current.isLoading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fetches recommendation successfully and validates response schema', async () => {
    const mockData = {
      deviceId: 'DEV_001',
      kpi: null,
      currentConfig: null,
      advisory: {
        rulesetVersion: 'v1.0.0',
        currentConfig: {
          lamp_gain_scale: 1.0,
          mist_gain_scale: 1.0,
          mist_on_threshold: 0.25,
          mist_off_threshold: 0.15,
        },
        suggestedConfig: {
          lamp_gain_scale: 1.0,
          mist_gain_scale: 1.0,
          mist_on_threshold: 0.25,
          mist_off_threshold: 0.15,
        },
        delta: {
          mist_on_threshold: 0.0,
        },
        triggeredRules: [],
        confidence: 'HIGH',
        expectedBenefit: 'Ổn định vi khí hậu.',
        kpiSnapshot: {
          deviceId: 'DEV_001',
          windowStart: '2026-07-27T00:00:00.000Z',
          windowEnd: '2026-07-27T10:00:00.000Z',
          tempRmse: 0.2,
          humidRmse: 1.5,
          mistSwitchCountPerHour: 2.0,
          mistOnDurationSec: 360,
          lampDutyCyclePercent: 45.0,
          lampAvgOnDurationSec: 120,
          overshootDurationSec: 0,
          undershootDurationSec: 0,
          dataCoveragePercent: 95.0,
          sampleCount: 720,
          configRevision: 1,
          dataQualityWarning: false,
        },
        observationWindowRequired: true,
      },
      blockReason: null,
      blockReasonDetail: null,
      generatedAt: '2026-07-27T10:00:00.000Z',
    }

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    } as Response)

    const { result } = renderHook(() => useTuningRecommendation('DEV_001'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data).toEqual(mockData)
    expect(result.current.error).toBeNull()
    expect(fetch).toHaveBeenCalledWith(
      '/api/backend/devices/DEV_001/analytics/tuning-recommendations',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('handles malformed payload without crashing and sets error', async () => {
    const malformedData = {
      deviceId: 'DEV_001',
      advisory: {
        suggestedConfig: { lamp_gain_scale: 'not-a-number' },
      },
    }

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => malformedData,
    } as Response)

    const { result } = renderHook(() => useTuningRecommendation('DEV_001'))

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data).toBeNull()
    expect(result.current.error).not.toBeNull()
    expect(result.current.error?.message).toContain('dữ liệu đề xuất không hợp lệ')
  })

  it('aborts previous request when deviceId changes or component unmounts', async () => {
    const signals: AbortSignal[] = []

    vi.mocked(fetch).mockImplementation((_url, init) => {
      if (init?.signal) {
        signals.push(init.signal)
      }
      return new Promise(() => {}) // pending promise
    })

    const { rerender, unmount } = renderHook(
      ({ id }: { id: string }) => useTuningRecommendation(id),
      { initialProps: { id: 'DEV_001' } },
    )

    await waitFor(() => expect(signals.length).toBe(1))
    expect(signals[0].aborted).toBe(false)

    rerender({ id: 'DEV_002' })
    await waitFor(() => expect(signals.length).toBe(2))
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)

    unmount()
    expect(signals[1].aborted).toBe(true)
  })
})
