import {
  RULESET_VERSION,
  RULE_THRESHOLDS,
  TuningRecommenderEngine,
} from './tuning-recommender-engine.service';
import type { TuningConfigSnapshot } from '../../tuning/entities/device-tuning-configuration.entity';
import type { KpiMetrics } from '../interfaces/kpi-metrics.interface';

const currentConfig: TuningConfigSnapshot = {
  lamp_gain_scale: 1,
  mist_gain_scale: 1,
  mist_on_threshold: 0.25,
  mist_off_threshold: 0.15,
};

const kpi: KpiMetrics = {
  deviceId: 'device-1',
  windowStart: new Date('2026-07-26T00:00:00.000Z'),
  windowEnd: new Date('2026-07-27T00:00:00.000Z'),
  tempRmse: 1,
  humidRmse: 1,
  mistSwitchCountPerHour: 1,
  mistOnDurationSec: 3600,
  lampDutyCyclePercent: 50,
  lampAvgOnDurationSec: 300,
  overshootDurationSec: 0,
  undershootDurationSec: 0,
  dataCoveragePercent: 100,
  sampleCount: 17280,
  configRevision: 1,
  dataQualityWarning: false,
};

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

  describe('generateRecommendation (I2)', () => {
    const engine = new TuningRecommenderEngine();

    it('returns an explicit conflict rather than silently selecting R1 or R3', () => {
      const result = engine.generateRecommendation(
        {
          ...kpi,
          mistSwitchCountPerHour: 11,
          humidRmse: 6,
        },
        currentConfig,
      );

      expect(result).toEqual({
        status: 'CONFLICT',
        conflictingRules: ['R1_MIST_CHATTERING', 'R3_HUMID_HIGH_MIST_OK'],
      });
    });

    it('creates a minimal R1 delta while preserving the supplied snapshot', () => {
      const sourceConfig = { ...currentConfig };
      const chatteringKpi = { ...kpi, mistSwitchCountPerHour: 11 };
      const result = engine.generateRecommendation(chatteringKpi, sourceConfig);

      expect(result.status).toBe('ADVISORY');
      if (result.status !== 'ADVISORY') {
        return;
      }

      expect(result.advisory).toMatchObject({
        rulesetVersion: RULESET_VERSION,
        currentConfig,
        suggestedConfig: {
          ...currentConfig,
          mist_on_threshold: 0.27,
        },
        delta: { mist_on_threshold: 0.27 },
        triggeredRules: ['R1_MIST_CHATTERING'],
        kpiSnapshot: chatteringKpi,
        observationWindowRequired: true,
      });
      expect(result.advisory.currentConfig).not.toBe(sourceConfig);
      expect(sourceConfig).toEqual(currentConfig);
    });

    it('combines non-conflicting R2 and R3 deltas deterministically', () => {
      const result = engine.generateRecommendation(
        {
          ...kpi,
          tempRmse: 1.6,
          lampDutyCyclePercent: 29,
          humidRmse: 5.1,
          mistSwitchCountPerHour: 10,
        },
        currentConfig,
      );

      expect(result.status).toBe('ADVISORY');
      if (result.status !== 'ADVISORY') {
        return;
      }

      expect(result.advisory.delta).toEqual({
        lamp_gain_scale: 1.05,
        mist_gain_scale: 1.05,
      });
      expect(result.advisory.triggeredRules).toEqual([
        'R2_TEMP_HIGH_LAMP_LOW',
        'R3_HUMID_HIGH_MIST_OK',
      ]);
    });

    it('returns no suggestion at exact rule thresholds', () => {
      const result = engine.generateRecommendation(
        {
          ...kpi,
          mistSwitchCountPerHour: 10,
          tempRmse: 1.5,
          humidRmse: 5,
          lampDutyCyclePercent: 30,
        },
        currentConfig,
      );

      expect(result).toEqual({
        status: 'NO_SUGGESTION',
        reason: 'No tuning rule was triggered by the current KPI window.',
      });
    });

    it('fails closed when a required evaluation input is absent', () => {
      expect(engine.generateRecommendation(null, currentConfig)).toEqual({
        status: 'INSUFFICIENT_DATA',
        reason: 'KPI and current tuning configuration are required.',
      });
      expect(engine.generateRecommendation(kpi, undefined)).toEqual({
        status: 'INSUFFICIENT_DATA',
        reason: 'KPI and current tuning configuration are required.',
      });
    });
  });

  describe('clampToHardBounds (I3)', () => {
    const engine = new TuningRecommenderEngine();

    it('clamps gain values to the inclusive [0.80, 1.20] hard bounds', () => {
      expect(engine.clampToHardBounds(0.5, 'gain')).toBe(0.8);
      expect(engine.clampToHardBounds(1.5, 'gain')).toBe(1.2);
      expect(engine.clampToHardBounds(1, 'gain')).toBe(1);
    });

    it('clamps mist_on values to the inclusive [0.20, 0.35] hard bounds', () => {
      expect(engine.clampToHardBounds(0.1, 'mist_on')).toBe(0.2);
      expect(engine.clampToHardBounds(0.4, 'mist_on')).toBe(0.35);
      expect(engine.clampToHardBounds(0.25, 'mist_on')).toBe(0.25);
    });

    it('clamps mist_off values to the inclusive [0.10, 0.20] hard bounds', () => {
      expect(engine.clampToHardBounds(0.05, 'mist_off')).toBe(0.1);
      expect(engine.clampToHardBounds(0.3, 'mist_off')).toBe(0.2);
      expect(engine.clampToHardBounds(0.15, 'mist_off')).toBe(0.15);
    });
  });

  describe('validateHysteresis (I4)', () => {
    const engine = new TuningRecommenderEngine();

    it('accepts only a finite Mist off threshold strictly below the on threshold', () => {
      expect(engine.validateHysteresis(0.25, 0.15)).toBe(true);
      expect(engine.validateHysteresis(0.2, 0.1)).toBe(true);
    });

    it('rejects equal and reversed thresholds without repairing either value', () => {
      expect(engine.validateHysteresis(0.2, 0.2)).toBe(false);
      expect(engine.validateHysteresis(0.15, 0.2)).toBe(false);
    });

    it('rejects non-finite thresholds', () => {
      expect(engine.validateHysteresis(Number.NaN, 0.15)).toBe(false);
      expect(engine.validateHysteresis(0.25, Number.POSITIVE_INFINITY)).toBe(
        false,
      );
    });

    it('blocks recommendation generation when the current hysteresis is invalid', () => {
      expect(
        engine.generateRecommendation(
          { ...kpi, mistSwitchCountPerHour: 11 },
          {
            ...currentConfig,
            mist_on_threshold: 0.15,
            mist_off_threshold: 0.2,
          },
        ),
      ).toEqual({
        status: 'NO_SUGGESTION',
        reason:
          'Current Mist hysteresis is invalid: mist_off_threshold must be strictly less than mist_on_threshold.',
      });
    });
  });
});
