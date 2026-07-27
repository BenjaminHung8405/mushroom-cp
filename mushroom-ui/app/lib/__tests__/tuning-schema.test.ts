import { describe, expect, it } from 'vitest'
import {
  parsePartialTuningSnapshot,
  parseTuningRecommendationResponse,
  parseTuningSnapshot,
  type TuningRecommendationResponseDto,
} from '@/app/lib/tuning-schema'

describe('tuning-schema runtime validation', () => {
  const validPayload: TuningRecommendationResponseDto = {
    deviceId: 'DEV_001',
    kpi: {
      deviceId: 'DEV_001',
      windowStart: '2026-07-27T00:00:00.000Z',
      windowEnd: '2026-07-27T10:00:00.000Z',
      tempRmse: 0.2,
      humidRmse: 1.5,
      mistSwitchCountPerHour: 12.5,
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
    currentConfig: {
      lamp_gain_scale: 1.0,
      mist_gain_scale: 1.0,
      mist_on_threshold: 0.25,
      mist_off_threshold: 0.15,
    },
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
        mist_on_threshold: 0.28,
        mist_off_threshold: 0.15,
      },
      delta: {
        mist_on_threshold: 0.03,
      },
      triggeredRules: ['R1_MIST_CHATTERING'],
      confidence: 'HIGH',
      expectedBenefit: 'Tăng ngưỡng Mist ON từ 0.25 lên 0.28 để giảm chattering.',
      kpiSnapshot: {
        deviceId: 'DEV_001',
        windowStart: '2026-07-27T00:00:00.000Z',
        windowEnd: '2026-07-27T10:00:00.000Z',
        tempRmse: 0.2,
        humidRmse: 1.5,
        mistSwitchCountPerHour: 12.5,
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

  it('validates a correct payload matching backend DTO with partial delta', () => {
    const result = parseTuningRecommendationResponse(validPayload, 'DEV_001')
    expect(result).toEqual(validPayload)
  })

  it('parses partial tuning delta correctly', () => {
    expect(parsePartialTuningSnapshot({ mist_on_threshold: 0.03 })).toEqual({
      mist_on_threshold: 0.03,
    })
    expect(parsePartialTuningSnapshot({ lamp_gain_scale: 0.05, mist_gain_scale: 0.05 })).toEqual({
      lamp_gain_scale: 0.05,
      mist_gain_scale: 0.05,
    })
    expect(parsePartialTuningSnapshot({})).toEqual({})
  })

  it('rejects unallowed keys in partial tuning delta', () => {
    expect(parsePartialTuningSnapshot({ unknown_param: 123 })).toBeNull()
  })

  it('rejects deviceId mismatch', () => {
    const result = parseTuningRecommendationResponse(validPayload, 'DEV_999')
    expect(result).toBeNull()
  })

  it('rejects invalid confidence level', () => {
    const badConfidence = JSON.parse(JSON.stringify(validPayload))
    badConfidence.advisory.confidence = 'VERY_HIGH'
    expect(parseTuningRecommendationResponse(badConfidence)).toBeNull()
  })

  it('validates blockReason with null advisory', () => {
    const reasons = ['INSUFFICIENT_DATA', 'DEVICE_OFFLINE', 'NO_SUGGESTION', 'CONFLICT'] as const
    for (const reason of reasons) {
      const payload = { ...validPayload, blockReason: reason, advisory: null }
      const result = parseTuningRecommendationResponse(payload, 'DEV_001')
      expect(result).not.toBeNull()
      expect(result?.blockReason).toBe(reason)
    }
  })

  it('rejects payload where both blockReason and advisory are populated (invariant violation)', () => {
    const invalid = { ...validPayload, blockReason: 'CONFLICT' }
    expect(parseTuningRecommendationResponse(invalid)).toBeNull()
  })

  it('rejects NaN or Infinity in config values', () => {
    const nanPayload = JSON.parse(JSON.stringify(validPayload))
    nanPayload.advisory.suggestedConfig.lamp_gain_scale = NaN
    expect(parseTuningRecommendationResponse(nanPayload)).toBeNull()

    const infSnapshot = {
      lamp_gain_scale: Infinity,
      mist_gain_scale: 1.0,
      mist_on_threshold: 0.25,
      mist_off_threshold: 0.15,
    }
    expect(parseTuningSnapshot(infSnapshot)).toBeNull()
  })

  it('enforces hard bounds for tuning snapshots (gain 0.80-1.20, mist ON 0.20-0.35, mist OFF 0.10-0.20)', () => {
    expect(
      parseTuningSnapshot({
        lamp_gain_scale: 0.79,
        mist_gain_scale: 1.0,
        mist_on_threshold: 0.25,
        mist_off_threshold: 0.15,
      }),
    ).toBeNull()

    expect(
      parseTuningSnapshot({
        lamp_gain_scale: 1.0,
        mist_gain_scale: 1.21,
        mist_on_threshold: 0.25,
        mist_off_threshold: 0.15,
      }),
    ).toBeNull()

    expect(
      parseTuningSnapshot({
        lamp_gain_scale: 1.0,
        mist_gain_scale: 1.0,
        mist_on_threshold: 0.19,
        mist_off_threshold: 0.15,
      }),
    ).toBeNull()

    expect(
      parseTuningSnapshot({
        lamp_gain_scale: 1.0,
        mist_gain_scale: 1.0,
        mist_on_threshold: 0.36,
        mist_off_threshold: 0.15,
      }),
    ).toBeNull()

    expect(
      parseTuningSnapshot({
        lamp_gain_scale: 1.0,
        mist_gain_scale: 1.0,
        mist_on_threshold: 0.25,
        mist_off_threshold: 0.09,
      }),
    ).toBeNull()

    expect(
      parseTuningSnapshot({
        lamp_gain_scale: 1.0,
        mist_gain_scale: 1.0,
        mist_on_threshold: 0.25,
        mist_off_threshold: 0.21,
      }),
    ).toBeNull()
  })

  it('enforces hysteresis invariant (mist_off_threshold < mist_on_threshold)', () => {
    expect(
      parseTuningSnapshot({
        lamp_gain_scale: 1.0,
        mist_gain_scale: 1.0,
        mist_on_threshold: 0.20,
        mist_off_threshold: 0.20,
      }),
    ).toBeNull()

    expect(
      parseTuningSnapshot({
        lamp_gain_scale: 1.0,
        mist_gain_scale: 1.0,
        mist_on_threshold: 0.20,
        mist_off_threshold: 0.20,
      }),
    ).toBeNull()
  })

  it('rejects payload when advisory kpiSnapshot deviceId does not match response deviceId', () => {
    const invalid = JSON.parse(JSON.stringify(validPayload))
    invalid.advisory.kpiSnapshot.deviceId = 'DEV_OTHER'
    expect(parseTuningRecommendationResponse(invalid, 'DEV_001')).toBeNull()
  })

  it('rejects payload when advisory currentConfig does not match top-level currentConfig', () => {
    const invalid = JSON.parse(JSON.stringify(validPayload))
    invalid.advisory.currentConfig.lamp_gain_scale = 1.10
    expect(parseTuningRecommendationResponse(invalid, 'DEV_001')).toBeNull()
  })

  it('rejects payload when delta is inconsistent with suggestedConfig and currentConfig', () => {
    const invalid = JSON.parse(JSON.stringify(validPayload))
    invalid.advisory.delta.mist_on_threshold = 0.08 // Should be 0.03
    expect(parseTuningRecommendationResponse(invalid, 'DEV_001')).toBeNull()
  })
})
