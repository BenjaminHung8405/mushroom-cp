import { Injectable } from '@nestjs/common';

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
 * This task (I1) establishes the immutable ruleset identity and thresholds.
 * The pure `generateRecommendation()` evaluation and its boundary/hysteresis
 * helpers are implemented in follow-up tasks (I2-I4).
 */
@Injectable()
export class TuningRecommenderEngine {
  readonly rulesetVersion = RULESET_VERSION;
  readonly thresholds: RuleThresholds = RULE_THRESHOLDS;
}
