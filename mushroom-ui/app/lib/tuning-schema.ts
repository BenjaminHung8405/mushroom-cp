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



const EPSILON = 1e-5

export function isValidTuningSnapshot(value: unknown): value is TuningConfigSnapshot {
  if (!isRecord(value)) return false
  const { lamp_gain_scale, mist_gain_scale, mist_on_threshold, mist_off_threshold } = value

  if (
    !isFiniteNumber(lamp_gain_scale) ||
    !isFiniteNumber(mist_gain_scale) ||
    !isFiniteNumber(mist_on_threshold) ||
    !isFiniteNumber(mist_off_threshold)
  ) {
    return false
  }

  if (lamp_gain_scale < 0.80 || lamp_gain_scale > 1.20) return false
  if (mist_gain_scale < 0.80 || mist_gain_scale > 1.20) return false
  if (mist_on_threshold < 0.20 || mist_on_threshold > 0.35) return false
  if (mist_off_threshold < 0.10 || mist_off_threshold > 0.20) return false

  if (mist_off_threshold >= mist_on_threshold) return false

  return true
}

export function isSnapshotEqual(
  a: TuningConfigSnapshot,
  b: TuningConfigSnapshot,
): boolean {
  return (
    Math.abs(a.lamp_gain_scale - b.lamp_gain_scale) < EPSILON &&
    Math.abs(a.mist_gain_scale - b.mist_gain_scale) < EPSILON &&
    Math.abs(a.mist_on_threshold - b.mist_on_threshold) < EPSILON &&
    Math.abs(a.mist_off_threshold - b.mist_off_threshold) < EPSILON
  )
}

export function isDeltaConsistent(
  currentConfig: TuningConfigSnapshot,
  suggestedConfig: TuningConfigSnapshot,
  delta: Partial<TuningConfigSnapshot>,
): boolean {
  const keys: (keyof TuningConfigSnapshot)[] = [
    'lamp_gain_scale',
    'mist_gain_scale',
    'mist_on_threshold',
    'mist_off_threshold',
  ]

  for (const k of keys) {
    const diff = suggestedConfig[k] - currentConfig[k]
    const hasChange = Math.abs(diff) > EPSILON
    const deltaVal = delta[k]

    if (hasChange) {
      if (deltaVal === undefined || !isFiniteNumber(deltaVal)) return false
      if (Math.abs(diff - deltaVal) > EPSILON) return false
    } else {
      if (deltaVal !== undefined && Math.abs(deltaVal) > EPSILON) return false
    }
  }

  return true
}

export function parseTuningSnapshot(value: unknown): TuningConfigSnapshot | null {
  if (!isValidTuningSnapshot(value)) return null
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

  const result: Partial<TuningConfigSnapshot> = {}

  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) return null
    const val = value[key]
    if (!isFiniteNumber(val)) return null
    result[key as keyof TuningConfigSnapshot] = val
  }

  return result
}

export function parseKpiMetrics(
  value: unknown,
  expectedDeviceId?: string | null,
): KpiMetrics | null {
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

  if (expectedDeviceId && value.deviceId !== expectedDeviceId) {
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

export function parseTuningAdvisory(
  value: unknown,
  expectedDeviceId?: string | null,
  topLevelCurrentConfig?: TuningConfigSnapshot | null,
): TuningAdvisory | null {
  if (value === null) return null
  if (!isRecord(value)) return null

  const suggestedConfig = parseTuningSnapshot(value.suggestedConfig)
  if (suggestedConfig === null) return null

  const currentConfig = parseTuningSnapshot(value.currentConfig)
  if (currentConfig === null) return null

  if (topLevelCurrentConfig && !isSnapshotEqual(currentConfig, topLevelCurrentConfig)) {
    return null
  }

  const delta = parsePartialTuningSnapshot(value.delta)
  if (delta === null) return null

  if (!isDeltaConsistent(currentConfig, suggestedConfig, delta)) {
    return null
  }

  const kpiSnapshot = parseKpiMetrics(value.kpiSnapshot, expectedDeviceId)
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

  const kpi = parseKpiMetrics(value.kpi, value.deviceId)
  if (value.kpi !== null && kpi === null) return null

  const currentConfig = parseTuningSnapshot(value.currentConfig)
  if (value.currentConfig !== null && currentConfig === null) return null

  const advisory = parseTuningAdvisory(value.advisory, value.deviceId, currentConfig)
  if (value.advisory !== null && advisory === null) return null

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
