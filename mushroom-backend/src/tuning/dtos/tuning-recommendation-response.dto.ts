import type { KpiMetrics } from '../../analytics/interfaces/kpi-metrics.interface';
import type { TuningAdvisory } from '../../analytics/interfaces/tuning-advisory.interface';
import type { TuningConfigSnapshot } from '../entities/device-tuning-configuration.entity';

/** Stable public reasons that can block an operator tuning action. */
export type TuningRecommendationBlockReason =
  'INSUFFICIENT_DATA' | 'DEVICE_OFFLINE' | 'NO_SUGGESTION' | 'CONFLICT';

/**
 * Canonical, implementation-safe response for the device tuning advisory API.
 *
 * The nullable fields deliberately preserve why a recommendation was not
 * generated rather than making clients infer that state from missing data.
 */
export class TuningRecommendationResponseDto {
  deviceId!: string;
  kpi!: KpiMetrics | null;
  currentConfig!: TuningConfigSnapshot | null;
  advisory!: TuningAdvisory | null;
  blockReason!: TuningRecommendationBlockReason | null;
  blockReasonDetail!: string | null;
  generatedAt!: string;
}
