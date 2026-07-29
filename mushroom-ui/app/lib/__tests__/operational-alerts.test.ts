import { describe, expect, it } from 'vitest'

import {
  deriveOperationalAlerts,
  reconcileOperationalAlerts,
} from '@/app/lib/operational-alerts'

const baseline = {
  deviceId: 'device-1',
  temperature: 31,
  humidity: 80,
  deviceStatus: 'ONLINE_ACTIVE' as const,
  lastTelemetryAt: '2026-07-01T00:00:00.000Z',
  blackoutActive: false,
  configSyncStatus: null,
}

describe('operational alerts', () => {
  it('raises a crimson CO₂ alert at 1,600 ppm but not at 1,000 ppm', () => {
    const critical = deriveOperationalAlerts({ ...baseline, co2: 1600 })
    expect(critical).toContainEqual(expect.objectContaining({
      id: 'co2-critical',
      severity: 'critical',
    }))

    const normal = deriveOperationalAlerts({ ...baseline, co2: 1000 })
    expect(normal.some((alert) => alert.id === 'co2-critical')).toBe(false)
  })

  it('groups repeated warning transitions inside 30 minutes', () => {
    const warning = deriveOperationalAlerts({ ...baseline, co2: 1300 })
    const at = Date.parse('2026-07-01T00:00:00.000Z')
    const first = reconcileOperationalAlerts([], warning, at)
    const resolved = reconcileOperationalAlerts(first, [], at + 60_000)
    const repeated = reconcileOperationalAlerts(resolved, warning, at + 2 * 60_000)

    expect(repeated).toHaveLength(1)
    expect(repeated[0]).toMatchObject({
      id: 'co2-warning',
      active: true,
      groupCount: 2,
    })
  })
})
