import {
  RULESET_VERSION,
  RULE_THRESHOLDS,
  TuningRecommenderEngine,
} from './tuning-recommender-engine.service';

describe('TuningRecommenderEngine (I1 — ruleset identity & thresholds)', () => {
  it('pins the immutable ruleset version', () => {
    expect(RULESET_VERSION).toBe('v1.0.0');
  });

  it('exposes the deterministic rule thresholds required by the plan', () => {
    expect(RULE_THRESHOLDS).toEqual({
      MIST_CHATTERING_SWITCHES_PER_HOUR: 10,
      TEMP_RMSE_HIGH: 1.5,
      HUMID_RMSE_HIGH: 5.0,
      MIN_LAMP_DUTY_CYCLE_PERCENT: 30,
      GAIN_SCALE_STEP: 0.05,
      MIST_THRESHOLD_STEP: 0.02,
    });
  });

  it('surfaces the ruleset identity through an instantiable provider', () => {
    const engine = new TuningRecommenderEngine();
    expect(engine.rulesetVersion).toBe(RULESET_VERSION);
    expect(engine.thresholds).toBe(RULE_THRESHOLDS);
  });

  it('freezes the thresholds so no branch can mutate them at runtime', () => {
    expect(Object.isFrozen(RULE_THRESHOLDS)).toBe(true);
    expect(() => {
      (RULE_THRESHOLDS as { GAIN_SCALE_STEP: number }).GAIN_SCALE_STEP = 0.1;
    }).toThrow(TypeError);
    expect(RULE_THRESHOLDS.GAIN_SCALE_STEP).toBe(0.05);
  });
});
