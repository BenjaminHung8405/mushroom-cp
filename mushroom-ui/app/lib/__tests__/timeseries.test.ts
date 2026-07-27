import { describe, expect, it } from 'vitest'

import {
  computeDegradedIntervals,
  detectChatteringWindows,
} from '@/lib/timeseries'

describe('detectChatteringWindows', () => {
  it('flags six transitions within eight minutes as a single window', () => {
    const base = 1_700_000_000_000
    const points = Array.from({ length: 7 }, (_, index) => ({
      ms: base + index * 60_000,
      mistState: index % 2 === 0,
      lampState: null,
      dataQuality: 'trusted' as const,
    }))
    const windows = detectChatteringWindows(points, 'mistState')
    expect(windows).toHaveLength(1)
    expect(windows[0].count).toBeGreaterThan(5)
    expect(windows[0].endMs - windows[0].startMs).toBeLessThanOrEqual(10 * 60_000)
  })

  it('does not flag three well-spaced transitions', () => {
    const base = 1_700_000_000_000
    const points = Array.from({ length: 4 }, (_, index) => ({
      ms: base + index * 5 * 60_000,
      mistState: index % 2 === 0,
      lampState: null,
      dataQuality: 'trusted' as const,
    }))
    expect(detectChatteringWindows(points, 'mistState')).toEqual([])
  })

  it('ignores transitions observed while dataQuality is degraded', () => {
    const base = 1_700_000_000_000
    const points = Array.from({ length: 7 }, (_, index) => ({
      ms: base + index * 60_000,
      mistState: index % 2 === 0,
      lampState: null,
      dataQuality: 'degraded' as const,
    }))
    expect(detectChatteringWindows(points, 'mistState')).toEqual([])
  })
})

describe('computeDegradedIntervals', () => {
  it('groups contiguous degraded samples into intervals', () => {
    const base = 1_700_000_000_000
    const points = [
      { ms: base + 0, dataQuality: 'trusted' as const },
      { ms: base + 1_000, dataQuality: 'degraded' as const },
      { ms: base + 2_000, dataQuality: 'degraded' as const },
      { ms: base + 3_000, dataQuality: 'trusted' as const },
      { ms: base + 4_000, dataQuality: 'degraded' as const },
      { ms: base + 5_000, dataQuality: 'trusted' as const },
    ]
    const intervals = computeDegradedIntervals(points)
    expect(intervals).toEqual([
      { startMs: base + 1_000, endMs: base + 2_000 },
      { startMs: base + 4_000, endMs: base + 4_000 },
    ])
  })

  it('returns an empty list when every sample is trusted', () => {
    const base = 1_700_000_000_000
    const points = [
      { ms: base + 0, dataQuality: 'trusted' as const },
      { ms: base + 1_000, dataQuality: 'trusted' as const },
    ]
    expect(computeDegradedIntervals(points)).toEqual([])
  })
})
