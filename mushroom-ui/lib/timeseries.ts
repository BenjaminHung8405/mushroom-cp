/** Keeps chart render work bounded while preserving temporal distribution. */
export function downsampleByTime<T>(
  values: T[],
  maxPoints: number,
  timestamp: (value: T) => number,
): T[] {
  if (values.length <= maxPoints) return values

  const sorted = [...values].sort((a, b) => timestamp(a) - timestamp(b))
  const start = timestamp(sorted[0])
  const end = timestamp(sorted[sorted.length - 1])
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) {
    const step = Math.ceil(sorted.length / maxPoints)
    return sorted.filter((_, index) => index % step === 0).slice(0, maxPoints)
  }

  const bucketMs = (end - start) / maxPoints
  const result: T[] = []
  let cursor = 0
  for (let bucket = 0; bucket < maxPoints && cursor < sorted.length; bucket += 1) {
    const bucketEnd = start + (bucket + 1) * bucketMs
    let last = sorted[cursor]
    while (cursor < sorted.length && timestamp(sorted[cursor]) <= bucketEnd) {
      last = sorted[cursor]
      cursor += 1
    }
    result.push(last)
  }
  return result
}

export type RelayField = 'mistState' | 'lampState'

export interface RelayStatePoint {
  ms: number
  mistState: boolean | null
  lampState: boolean | null
}

/**
 * Detects a relay with more than `maxTransitions` state changes during any
 * rolling interval. This deliberately runs before downsampling.
 */
export function hasRelayChattering(
  points: RelayStatePoint[],
  field: RelayField,
  maxTransitions = 5,
  windowMs = 10 * 60_000,
): boolean {
  const transitions: number[] = []
  let previous: boolean | null = null

  for (const point of [...points].sort((a, b) => a.ms - b.ms)) {
    const next = point[field]
    if (next === null) continue
    if (previous !== null && next !== previous) transitions.push(point.ms)
    previous = next
  }

  let start = 0
  for (let end = 0; end < transitions.length; end += 1) {
    while (transitions[end] - transitions[start] > windowMs) start += 1
    if (end - start + 1 > maxTransitions) return true
  }
  return false
}

export interface ChatteringWindow {
  /** Inclusive start (ms since epoch). */
  startMs: number
  /** Inclusive end (ms since epoch). */
  endMs: number
  /** Number of transitions detected inside the merged window. */
  count: number
}

/**
 * Returns the merged intervals during which a relay chattered above the
 * `maxTransitions` threshold within any rolling `windowMs`. Transitions
 * observed while `dataQuality === 'degraded'` are ignored so interpolated
 * gaps do not raise false positives.
 */
export function detectChatteringWindows(
  points: (RelayStatePoint & { dataQuality?: 'trusted' | 'degraded' })[],
  field: RelayField,
  {
    maxTransitions = 5,
    windowMs = 10 * 60_000,
  }: { maxTransitions?: number; windowMs?: number } = {},
): ChatteringWindow[] {
  const sorted = [...points].sort((a, b) => a.ms - b.ms)
  const transitions: number[] = []
  let previous: boolean | null = null

  for (const point of sorted) {
    if (point.dataQuality === 'degraded') continue
    const next = point[field]
    if (next === null) continue
    if (previous !== null && next !== previous) transitions.push(point.ms)
    previous = next
  }

  if (transitions.length === 0) return []

  const windows: ChatteringWindow[] = []
  let start = 0
  for (let end = 0; end < transitions.length; end += 1) {
    while (transitions[end] - transitions[start] > windowMs) start += 1
    if (end - start + 1 > maxTransitions) {
      const startMs = transitions[start]
      const endMs = transitions[end]
      const count = end - start + 1
      const last = windows[windows.length - 1]
      if (last && startMs <= last.endMs) {
        last.endMs = Math.max(last.endMs, endMs)
        last.count = Math.max(last.count, count)
      } else {
        windows.push({ startMs, endMs, count })
      }
    }
  }
  return windows
}

export interface DegradedIntervalPoint {
  ms: number
  dataQuality: 'trusted' | 'degraded'
}

export interface DegradedInterval {
  startMs: number
  endMs: number
}

/**
 * Groups contiguous `degraded` samples into inclusive intervals. Callers can
 * paint a hatched overlay to show the operator that this slice is estimated.
 */
export function computeDegradedIntervals(
  points: DegradedIntervalPoint[],
): DegradedInterval[] {
  const sorted = [...points].sort((a, b) => a.ms - b.ms)
  const intervals: DegradedInterval[] = []
  let openStart: number | null = null
  let openEnd: number | null = null

  for (const point of sorted) {
    if (point.dataQuality === 'degraded') {
      if (openStart === null) openStart = point.ms
      openEnd = point.ms
    } else if (openStart !== null && openEnd !== null) {
      intervals.push({ startMs: openStart, endMs: openEnd })
      openStart = null
      openEnd = null
    }
  }
  if (openStart !== null && openEnd !== null) {
    intervals.push({ startMs: openStart, endMs: openEnd })
  }
  return intervals
}
