export interface BatchCheckpoint {
  day: number
  value: number
}

export interface BatchLightDayState {
  day: number
  active: boolean
}

export interface BatchEditBaseline {
  batchId: string
  temperature: BatchCheckpoint[]
  humidity: BatchCheckpoint[]
  light: BatchLightDayState[]
}

export interface BatchEditState {
  temperature: BatchCheckpoint[]
  humidity: BatchCheckpoint[]
  light: BatchLightDayState[]
}

function sameCheckpoints(current: BatchCheckpoint[], baseline: BatchCheckpoint[]): boolean {
  return current.length === baseline.length && current.every((checkpoint, index) => (
    checkpoint.day === baseline[index].day && checkpoint.value === baseline[index].value
  ))
}

function sameLightDayStates(current: BatchLightDayState[], baseline: BatchLightDayState[]): boolean {
  return current.length === baseline.length && current.every((state, index) => (
    state.day === baseline[index].day && state.active === baseline[index].active
  ))
}

/** Create an immutable-by-convention snapshot of the last fully saved batch state. */
export function createBatchEditBaseline(batchId: string, state: BatchEditState): BatchEditBaseline {
  return {
    batchId,
    temperature: state.temperature.map(({ day, value }) => ({ day, value })),
    humidity: state.humidity.map(({ day, value }) => ({ day, value })),
    light: state.light.map(({ day, active }) => ({ day, active })),
  }
}

/**
 * Compare values rather than React object identity. Ordering and day identity are
 * deliberate: an invalid/reordered track must remain saveable instead of being
 * mistakenly treated as unchanged.
 */
export function hasBatchEditChanges(
  baseline: BatchEditBaseline | null,
  batchId: string | null,
  state: BatchEditState,
): boolean {
  if (!baseline || !batchId || baseline.batchId !== batchId) return false

  return !sameCheckpoints(state.temperature, baseline.temperature) ||
    !sameCheckpoints(state.humidity, baseline.humidity) ||
    !sameLightDayStates(state.light, baseline.light)
}
