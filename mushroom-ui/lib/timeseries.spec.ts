import assert from 'node:assert/strict'
import test from 'node:test'
import { downsampleByTime, hasRelayChattering } from './timeseries'

test('downsampleByTime preserves chronological coverage within its rendering cap', () => {
  const points = Array.from({ length: 1_000 }, (_, index) => ({ timestamp: index }))
  const sampled = downsampleByTime(points, 100, (point) => point.timestamp)

  assert.ok(sampled.length <= 100)
  assert.deepEqual([...sampled].sort((a, b) => a.timestamp - b.timestamp), sampled)
})

test('hasRelayChattering only alerts above five transitions in ten minutes', () => {
  const normal = Array.from({ length: 6 }, (_, index) => ({
    ms: index * 120_000,
    mistState: index % 2 === 0,
    lampState: null,
  }))
  const chattering = Array.from({ length: 7 }, (_, index) => ({
    ms: index * 60_000,
    mistState: index % 2 === 0,
    lampState: null,
  }))

  assert.equal(hasRelayChattering(normal, 'mistState'), false)
  assert.equal(hasRelayChattering(chattering, 'mistState'), true)
})
