export type TuningBlockReason =
  | 'INSUFFICIENT_DATA'
  | 'DEVICE_OFFLINE'
  | 'NO_SUGGESTION'
  | 'CONFLICT'

export type AdvisoryConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

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
  mistOnDurationSec: number
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
  confidence: AdvisoryConfidence
  expectedBenefit: string
  kpiSnapshot: KpiMetrics
  observationWindowRequired: boolean
}

export interface TuningRecommendationResponseDto {
  deviceId: string
  kpi: KpiMetrics | null
  currentConfig: TuningConfigSnapshot | null
  advisory: TuningAdvisory | null
  blockReason: TuningBlockReason | null
  blockReasonDetail: string | null
  generatedAt: string
}

export function parseTuningRecommendationResponse(
  value: unknown,
  expectedDeviceId?: string | null,
): TuningRecommendationResponseDto | null {
  if (!isRecord(value)) return null

  if (typeof value.deviceId !== 'string' || !value.deviceId.trim()) return null
  if (expectedDeviceId && value.deviceId !== expectedDeviceId) return null

  if (!isBlockReason(value.blockReason)) return null
  if (!isNullableString(value.blockReasonDetail)) return null
  if (typeof value.generatedAt !== 'string' || !value.generatedAt.trim()) return null

  const kpi = parseKpiMetrics(value.kpi)
  if (value.kpi !== null && kpi === null) return null

  const currentConfig = parseTuningSnapshot(value.currentConfig)
  if (value.currentConfig !== null && currentConfig === null) return null

  const advisory = parseTuningAdvisory(value.advisory)
  if (value.advisory !== null && advisory === null) return null

  // Invariant validation: If blockReason is specified, advisory should be null
  if (value.blockReason !== null && advisory !== null) return null

  return {
    deviceId: value.deviceId,
    kpi,
    currentConfig,
    advisory,
    blockReason: value.blockReason,
    blockReasonDetail: value.blockReasonDetail,
    generatedAt: value.generatedAt,
  }
}

export function parseKpiMetrics(value: unknown): KpiMetrics | null {
  if (value === null) return null
  if (!isRecord(value)) return null

  if (
    typeof value.deviceId !== 'string' ||
    !value.deviceId.trim() ||
    typeof value.windowStart !== 'string' ||
    !value.windowStart.trim() ||
    typeof value.windowEnd !== 'string' ||
    !value.windowEnd.trim() ||
    !isFiniteNumber(value.tempRmse) ||
    !isFiniteNumber(value.humidRmse) ||
    !isFiniteNumber(value.mistSwitchCountPerHour) ||
    !isFiniteNumber(value.mistOnDurationSec) ||
    !isFiniteNumber(value.lampDutyCyclePercent) ||
    !isFiniteNumber(value.lampAvgOnDurationSec) ||
    !isFiniteNumber(value.overshootDurationSec) ||
    !isFiniteNumber(value.undershootDurationSec) ||
    !isFiniteNumber(value.dataCoveragePercent) ||
    !isFiniteNumber(value.sampleCount) ||
    !isNullableFiniteNumber(value.configRevision) ||
    typeof value.dataQualityWarning !== 'boolean'
  ) {
    return null
  }

  return {
    deviceId: value.deviceId,
    windowStart: value.windowStart,
    windowEnd: value.windowEnd,
    tempRmse: value.tempRmse,
    humidRmse: value.humidRmse,
    mistSwitchCountPerHour: value.mistSwitchCountPerHour,
    mistOnDurationSec: value.mistOnDurationSec,
    lampDutyCyclePercent: value.lampDutyCyclePercent,
    lampAvgOnDurationSec: value.lampAvgOnDurationSec,
    overshootDurationSec: value.overshootDurationSec,
    undershootDurationSec: value.undershootDurationSec,
    dataCoveragePercent: value.dataCoveragePercent,
    sampleCount: value.sampleCount,
    configRevision: value.configRevision,
    dataQualityWarning: value.dataQualityWarning,
  }
}

export function parseTuningSnapshot(value: unknown): TuningConfigSnapshot | null {
  if (value === null) return null
  if (!isRecord(value)) return null

  if (
    !isFiniteNumber(value.lamp_gain_scale) ||
    !isFiniteNumber(value.mist_gain_scale) ||
    !isFiniteNumber(value.mist_on_threshold) ||
    !isFiniteNumber(value.mist_off_threshold)
  ) {
    return null
  }

  return {
    lamp_gain_scale: value.lamp_gain_scale,
    mist_gain_scale: value.mist_gain_scale,
    mist_on_threshold: value.mist_on_threshold,
    mist_off_threshold: value.mist_off_threshold,
  }
}

export function parsePartialTuningSnapshot(
  value: unknown,
): Partial<TuningConfigSnapshot> | null {
  if (value === null) return null
  if (!isRecord(value)) return null

  const allowedKeys = new Set([
    'lamp_gain_scale',
    'mist_gain_scale',
    'mist_on_threshold',
    'mist_off_threshold',
  ])

  const keys = Object.keys(value)
  const result: Partial<TuningConfigSnapshot> = {}

  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      return null
    }
    const val = value[key]
    if (!isFiniteNumber(val)) {
      return null
    }
    result[key as keyof TuningConfigSnapshot] = val
  }

  return result
}

export function parseTuningAdvisory(value: unknown): TuningAdvisory | null {
  if (value === null) return null
  if (!isRecord(value)) return null

  const suggestedConfig = parseTuningSnapshot(value.suggestedConfig)
  if (suggestedConfig === null) return null

  const currentConfig = parseTuningSnapshot(value.currentConfig)
  if (currentConfig === null) return null

  const delta = parsePartialTuningSnapshot(value.delta)
  if (delta === null) return null

  const kpiSnapshot = parseKpiMetrics(value.kpiSnapshot)
  if (kpiSnapshot === null) return null

  if (
    !Array.isArray(value.triggeredRules) ||
    !value.triggeredRules.every((r) => typeof r === 'string') ||
    !isAdvisoryConfidence(value.confidence) ||
    typeof value.rulesetVersion !== 'string' ||
    !value.rulesetVersion.trim() ||
    typeof value.expectedBenefit !== 'string' ||
    typeof value.observationWindowRequired !== 'boolean'
  ) {
    return null
  }

  return {
    rulesetVersion: value.rulesetVersion,
    currentConfig,
    suggestedConfig,
    delta,
    triggeredRules: value.triggeredRules,
    confidence: value.confidence,
    expectedBenefit: value.expectedBenefit,
    kpiSnapshot,
    observationWindowRequired: value.observationWindowRequired,
  }
}

function isBlockReason(value: unknown): value is TuningBlockReason | null {
  return (
    value === null ||
    value === 'INSUFFICIENT_DATA' ||
    value === 'DEVICE_OFFLINE' ||
    value === 'NO_SUGGESTION' ||
    value === 'CONFLICT'
  )
}

function isAdvisoryConfidence(value: unknown): value is AdvisoryConfidence {
  return value === 'HIGH' || value === 'MEDIUM' || value === 'LOW'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}
