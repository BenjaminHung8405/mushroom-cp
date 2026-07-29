import { describe, expect, it } from 'vitest'

import { isMistingAllowed, vietnamMinutesSinceMidnight } from '@/app/lib/operational-safety'

describe('isMistingAllowed', () => {
  it.each([
    ['2026-07-01T00:58:00.000Z', 7 * 60 + 58, true],
    ['2026-07-01T01:02:00.000Z', 8 * 60 + 2, false],
    ['2026-07-01T10:30:00.000Z', 17 * 60 + 30, true],
    ['2026-07-01T11:15:00.000Z', 18 * 60 + 15, false],
  ])('evaluates %s as %i Vietnam minutes', (timestamp, expectedMinutes, expected) => {
    expect(vietnamMinutesSinceMidnight(timestamp)).toBe(expectedMinutes)
    expect(isMistingAllowed(timestamp)).toBe(expected)
  })
})
