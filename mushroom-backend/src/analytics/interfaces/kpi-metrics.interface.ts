/**
 * Rolling control KPI returned by the analytics layer.
 *
 * Values are aggregated from trusted controller-history samples only. A
 * nullable revision and the quality warning are intentional: a KPI window
 * can be usable for observation while still lacking one unambiguous config
 * revision or containing mixed-quality source data.
 */
export interface KpiMetrics {
  deviceId: string;
  windowStart: Date;
  windowEnd: Date;
  tempRmse: number;
  humidRmse: number;
  mistSwitchCountPerHour: number;
  lampDutyCyclePercent: number;
  lampAvgOnDurationSec: number;
  overshootDurationSec: number;
  undershootDurationSec: number;
  dataCoveragePercent: number;
  sampleCount: number;
  configRevision: number | null;
  dataQualityWarning: boolean;
}
