import type { TuningConfigSnapshot } from '../../tuning/entities/device-tuning-configuration.entity';
import type { KpiMetrics } from './kpi-metrics.interface';

export type AdvisoryConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * A deterministic, operator-approved tuning proposal. The complete suggested
 * snapshot is kept alongside its minimal delta so consumers can both render a
 * safe diff and submit the canonical v1 tuning payload.
 */
export interface TuningAdvisory {
  rulesetVersion: string;
  currentConfig: TuningConfigSnapshot;
  suggestedConfig: TuningConfigSnapshot;
  delta: Partial<TuningConfigSnapshot>;
  triggeredRules: string[];
  confidence: AdvisoryConfidence;
  expectedBenefit: string;
  kpiSnapshot: KpiMetrics;
  observationWindowRequired: boolean;
}

/**
 * All outcomes from recommendation evaluation. Consumers must switch on
 * `status`, rather than infer an outcome from nullable advisory fields.
 */
export type RecommendationResult =
  | { status: 'ADVISORY'; advisory: TuningAdvisory }
  | { status: 'INSUFFICIENT_DATA'; reason: string }
  | { status: 'NO_SUGGESTION'; reason: string }
  | { status: 'CONFLICT'; conflictingRules: string[] };
