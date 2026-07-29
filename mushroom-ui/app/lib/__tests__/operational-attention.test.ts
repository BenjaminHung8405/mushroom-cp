import { describe, expect, it } from 'vitest'

import { buildOperationalAttention } from '@/app/lib/operational-attention'
import { emptyOperationalHistorySummary } from '@/app/lib/operational-history'
import type { AlertEntry } from '@/app/lib/operational-alerts'

function warning(id: string, category: AlertEntry['category']): AlertEntry {
  return {
    id,
    deviceId: 'device-1',
    severity: 'warning',
    category,
    title: id,
    message: `${id} message`,
    createdAt: '2026-07-01T00:00:00.000Z',
    source: 'telemetry',
    active: true,
    groupCount: 1,
  }
}

describe('buildOperationalAttention', () => {
  it('prioritizes relay chattering and limits actionable items to two', () => {
    const history = {
      ...emptyOperationalHistorySummary(),
      chattering: [{ startMs: 100, endMs: 200, count: 7, field: 'mistState' as const }],
    }
    const items = buildOperationalAttention([
      warning('sync-warning', 'synchronization'),
      warning('environment-warning', 'environment'),
    ], history)

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      target: 'analysis',
      focusChatterAt: 100,
    })
    expect(items[1]).toMatchObject({ id: 'sync-warning', target: 'curves' })
  })

  it('routes environmental warnings to the Alert Center', () => {
    const items = buildOperationalAttention(
      [warning('environment-warning', 'environment')],
      emptyOperationalHistorySummary(),
    )

    expect(items).toEqual([expect.objectContaining({ target: 'alerts' })])
  })

  it('prioritizes connectivity and sync actions ahead of environmental amber states', () => {
    const items = buildOperationalAttention([
      warning('environment-warning', 'environment'),
      warning('sync-warning', 'synchronization'),
      warning('device-warning', 'connectivity'),
    ], emptyOperationalHistorySummary())

    expect(items.map((item) => item.id)).toEqual(['device-warning', 'sync-warning'])
  })
})
