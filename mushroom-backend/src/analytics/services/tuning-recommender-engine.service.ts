import { Injectable } from '@nestjs/common';
import type { TuningConfigSnapshot } from '../../tuning/entities/device-tuning-configuration.entity';
import type { KpiMetrics } from '../interfaces/kpi-metrics.interface';
import type {
  RecommendationResult,
  TuningAdvisory,
} from '../interfaces/tuning-advisory.interface';

/**
 * Immutable recommender ruleset identity.
 *
 * Bumped whenever the rule table or thresholds change so every emitted
 * {@link TuningAdvisory} is traceable to the exact logic that produced it.
 */
export const RULESET_VERSION = 'v1.0.0';

/**
 * Deterministic thresholds and step sizes for the tuning rule table.
 *
 * Declared `as const` so the values are the single source of truth for the
 * rule engine. Rules must reference these constants instead of embedding
 * magic numbers inside individual branches.
 */
export const RULE_THRESHOLDS = Object.freeze({
  /** R1: Mist relay is chattering above this many false->true switches per hour. */
  MIST_CHATTERING_SWITCHES_PER_HOUR: 10,
  /** R2: Temperature RMSE (deg C) considered high. */
  TEMP_RMSE_HIGH: 1.5,
  /** R3: Humidity RMSE (percent) considered high. */
  HUMID_RMSE_HIGH: 5.0,
  /** R2: Lamp duty cycle below this percent is considered under-driven. */
  MIN_LAMP_DUTY_CYCLE_PERCENT: 30,
  /** Maximum gain-scale adjustment applied per recommendation. */
  GAIN_SCALE_STEP: 0.05,
  /** Mist on-threshold step applied to dampen chattering. */
  MIST_THRESHOLD_STEP: 0.02,
} as const);

export type RuleThresholds = typeof RULE_THRESHOLDS;

/**
 * Deterministic, side-effect-free tuning recommender.
 *
 * It evaluates the rule table, delegates safe delta construction to the I3
 * boundary helper, enforces the I4 hysteresis invariant, and creates an
 * immutable advisory payload.
 */
@Injectable()
export class TuningRecommenderEngine {
  readonly rulesetVersion = RULESET_VERSION;
  readonly thresholds: RuleThresholds = RULE_THRESHOLDS;

  /**
   * Evaluates the v1 rule table without I/O, mutation, or dependency access.
   *
   * A high-humidity candidate conflicts with mist chattering even though the
   * non-conflicting R3 path requires stable Mist. Returning the conflict
   * explicitly prevents an unsafe, silent choice between damping relay
   * switching and increasing Mist gain.
   */
  generateRecommendation(
    kpi: KpiMetrics | null | undefined,
    currentConfig: TuningConfigSnapshot | null | undefined,
  ): RecommendationResult {
    if (kpi == null || currentConfig == null) {
      return {
        status: 'INSUFFICIENT_DATA',
        reason: 'KPI and current tuning configuration are required.',
      };
    }
    if (
      !this.validateHysteresis(
        currentConfig.mist_on_threshold,
        currentConfig.mist_off_threshold,
      )
    ) {
      return {
        status: 'NO_SUGGESTION',
        reason:
          'Current Mist hysteresis is invalid: mist_off_threshold must be strictly less than mist_on_threshold.',
      };
    }

    const flags = this.evaluateRules(kpi);
    if (flags.isMistChattering && flags.hasHighHumidity) {
      return {
        status: 'CONFLICT',
        conflictingRules: ['R1_MIST_CHATTERING', 'R3_HUMID_HIGH_MIST_OK'],
      };
    }

    const { delta, triggeredRules } = this.buildDelta(flags, currentConfig);
    if (triggeredRules.length === 0) {
      return {
        status: 'NO_SUGGESTION',
        reason: 'No tuning rule was triggered by the current KPI window.',
      };
    }

    return {
      status: 'ADVISORY',
      advisory: this.buildAdvisory(currentConfig, delta, triggeredRules, kpi),
    };
  }

  private evaluateRules(kpi: KpiMetrics): {
    isMistChattering: boolean;
    hasHighHumidity: boolean;
    hasHighTempWithLowLamp: boolean;
  } {
    return {
      isMistChattering:
        kpi.mistSwitchCountPerHour >
        this.thresholds.MIST_CHATTERING_SWITCHES_PER_HOUR,
      hasHighHumidity: kpi.humidRmse > this.thresholds.HUMID_RMSE_HIGH,
      hasHighTempWithLowLamp:
        kpi.tempRmse > this.thresholds.TEMP_RMSE_HIGH &&
        kpi.lampDutyCyclePercent < this.thresholds.MIN_LAMP_DUTY_CYCLE_PERCENT,
    };
  }

  private buildDelta(
    flags: {
      isMistChattering: boolean;
      hasHighHumidity: boolean;
      hasHighTempWithLowLamp: boolean;
    },
    currentConfig: TuningConfigSnapshot,
  ): { delta: Partial<TuningConfigSnapshot>; triggeredRules: string[] } {
    const delta: Partial<TuningConfigSnapshot> = {};
    const triggeredRules: string[] = [];

    if (flags.isMistChattering) {
      delta.mist_on_threshold = this.clampToHardBounds(
        currentConfig.mist_on_threshold + this.thresholds.MIST_THRESHOLD_STEP,
        'mist_on',
      );
      triggeredRules.push('R1_MIST_CHATTERING');
    }

    if (flags.hasHighTempWithLowLamp) {
      delta.lamp_gain_scale = this.clampToHardBounds(
        currentConfig.lamp_gain_scale + this.thresholds.GAIN_SCALE_STEP,
        'gain',
      );
      triggeredRules.push('R2_TEMP_HIGH_LAMP_LOW');
    }

    if (flags.hasHighHumidity) {
      delta.mist_gain_scale = this.clampToHardBounds(
        currentConfig.mist_gain_scale + this.thresholds.GAIN_SCALE_STEP,
        'gain',
      );
      triggeredRules.push('R3_HUMID_HIGH_MIST_OK');
    }

    return { delta, triggeredRules };
  }

  private buildAdvisory(
    currentConfig: TuningConfigSnapshot,
    delta: Partial<TuningConfigSnapshot>,
    triggeredRules: string[],
    kpi: KpiMetrics,
  ): TuningAdvisory {
    const suggestedConfig: TuningConfigSnapshot = {
      ...currentConfig,
      ...delta,
    };
    return {
      rulesetVersion: this.rulesetVersion,
      currentConfig: { ...currentConfig },
      suggestedConfig,
      delta,
      triggeredRules,
      confidence: 'MEDIUM',
      expectedBenefit: this.describeExpectedBenefit(triggeredRules),
      kpiSnapshot: kpi,
      observationWindowRequired: true,
    };
  }

  /**
   * Boundary Validation Pattern
   *
   * Áp cứng PLAN v2.2:
   * - gain: [0.80, 1.20]
   * - mist_on: [0.20, 0.35]
   * - mist_off: [0.10, 0.20]
   *
   * Không đề xuất bất kỳ key TPC/PWM/HWat/parameter không có firmware source-of-truth.
   */
  clampToHardBounds(
    value: number,
    type: 'gain' | 'mist_on' | 'mist_off',
  ): number {
    let min = 0;
    let max = 0;
    switch (type) {
      case 'gain':
        min = 0.8;
        max = 1.2;
        break;
      case 'mist_on':
        min = 0.2;
        max = 0.35;
        break;
      case 'mist_off':
        min = 0.1;
        max = 0.2;
        break;
    }
    return Math.max(min, Math.min(max, value));
  }

  /**
   * Validates the physical Mist relay hysteresis invariant without attempting
   * to repair a malformed proposal. Callers must block an invalid snapshot
   * rather than infer or mutate a replacement threshold.
   */
  validateHysteresis(on: number, off: number): boolean {
    return Number.isFinite(on) && Number.isFinite(off) && off < on;
  }

  private describeExpectedBenefit(triggeredRules: readonly string[]): string {
    if (triggeredRules.includes('R1_MIST_CHATTERING')) {
      return 'Reduce Mist relay chattering through a higher activation threshold.';
    }

    if (triggeredRules.includes('R2_TEMP_HIGH_LAMP_LOW')) {
      return 'Improve temperature tracking by increasing Lamp control gain.';
    }

    return 'Improve humidity tracking by increasing Mist control gain.';
  }
}
