import assert from 'node:assert/strict'
import test from 'node:test'
import { createBatchEditBaseline, hasBatchEditChanges, type BatchEditState } from './batch-dirty'

const initial: BatchEditState = {
  temperature: [{ day: 1, value: 30 }, { day: 7, value: 32 }],
  humidity: [{ day: 1, value: 80 }, { day: 7, value: 85 }],
  light: [
    { day: 1, active: true },
    { day: 2, active: true },
    { day: 3, active: false },
    { day: 4, active: false },
  ],
}

function changed(overrides: Partial<BatchEditState>): BatchEditState {
  return {
    temperature: overrides.temperature ?? initial.temperature,
    humidity: overrides.humidity ?? initial.humidity,
    light: overrides.light ?? initial.light,
  }
}

test('batch edit state is clean when it matches its baseline', () => {
  const baseline = createBatchEditBaseline('batch-1', initial)
  assert.equal(hasBatchEditChanges(baseline, 'batch-1', initial), false)
})

test('batch edit state detects temperature and humidity checkpoint changes', () => {
  const baseline = createBatchEditBaseline('batch-1', initial)

  assert.equal(hasBatchEditChanges(baseline, 'batch-1', changed({
    temperature: [{ day: 1, value: 30.5 }, { day: 7, value: 32 }],
  })), true)
  assert.equal(hasBatchEditChanges(baseline, 'batch-1', changed({
    humidity: [{ day: 1, value: 80 }, { day: 7, value: 84 }],
  })), true)
})

test('batch edit state detects a single light-day toggle and a dragged block edge', () => {
  const baseline = createBatchEditBaseline('batch-1', initial)

  assert.equal(hasBatchEditChanges(baseline, 'batch-1', changed({
    light: [{ day: 1, active: true }, { day: 2, active: false }, { day: 3, active: false }, { day: 4, active: false }],
  })), true)
  assert.equal(hasBatchEditChanges(baseline, 'batch-1', changed({
    light: [{ day: 1, active: true }, { day: 2, active: true }, { day: 3, active: true }, { day: 4, active: true }],
  })), true)
})

test('reverting a light schedule restores the clean state', () => {
  const baseline = createBatchEditBaseline('batch-1', initial)
  const toggled = changed({
    light: [{ day: 1, active: true }, { day: 2, active: false }, { day: 3, active: false }, { day: 4, active: false }],
  })

  assert.equal(hasBatchEditChanges(baseline, 'batch-1', toggled), true)
  assert.equal(hasBatchEditChanges(baseline, 'batch-1', initial), false)
})

test('a changed track length or day ordering is dirty', () => {
  const baseline = createBatchEditBaseline('batch-1', initial)

  assert.equal(hasBatchEditChanges(baseline, 'batch-1', changed({
    light: initial.light.slice(0, 3),
  })), true)
  assert.equal(hasBatchEditChanges(baseline, 'batch-1', changed({
    light: [{ day: 2, active: true }, { day: 1, active: true }, { day: 3, active: false }, { day: 4, active: false }],
  })), true)
})
