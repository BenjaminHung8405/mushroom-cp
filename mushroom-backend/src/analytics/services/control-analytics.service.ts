import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { QueryApi } from '@influxdata/influxdb-client';
import { InfluxDbService } from '../../influx/services/influx-db.service';
import { ConfigService } from '../../influx/services/config.service';
import type { KpiMetrics } from '../interfaces/kpi-metrics.interface';

const HOURS_PER_DAY = 24;
const SECONDS_PER_HOUR = 3_600;
const MAX_WINDOW_HOURS = 168;
const MIN_COVERAGE_PERCENT = 80;
const MIN_TRUSTED_SAMPLES = 100;
const DEVICE_ONLINE_WINDOW_MS = 5 * 60 * 1_000;
const SAMPLES_PER_HOUR = 720;
const MAX_SAFE_METRIC = Number.MAX_SAFE_INTEGER;

export type CoverageGateFailureReason =
  | 'COVERAGE_BELOW_80_PERCENT'
  | 'INSUFFICIENT_TRUSTED_SAMPLES'
  | 'CONFIG_REVISION_UNAVAILABLE'
  | 'INVALID_KPI_DATA';

export type CoverageGateResult =
  { allowed: true } | { allowed: false; reason: CoverageGateFailureReason };

interface HourlyKpiRow {
  sampleCount: number;
  tempSquaredError: number;
  humidSquaredError: number;
  mistSwitchCount: number;
  lampOnDurationSec: number;
  lampSessionCount: number;
  overshootDurationSec: number;
  undershootDurationSec: number;
  expectedSamples: number;
  validSamples: number;
  configRevision: number | null;
  dataQualityWarning: boolean;
}

interface HourlyNumericValues {
  sampleCount: number;
  tempSquaredError: number;
  humidSquaredError: number;
  mistSwitchCount: number;
  lampOnDurationSec: number;
  lampSessionCount: number;
  overshootDurationSec: number;
  undershootDurationSec: number;
  expectedSamples: number;
  validSamples: number;
}

interface KpiTotal {
  sampleCount: number;
  tempSquaredError: number;
  humidSquaredError: number;
  mistSwitchCount: number;
  lampOnDurationSec: number;
  lampSessionCount: number;
  overshootDurationSec: number;
  undershootDurationSec: number;
  expectedSamples: number;
  validSamples: number;
  dataQualityWarning: boolean;
}

@Injectable()
export class ControlAnalyticsService {
  constructor(
    private readonly influxDbService: InfluxDbService,
    private readonly configService: ConfigService,
  ) {}

  /** Blocks recommendation generation until the KPI window is trustworthy. */
  checkCoverageGate(kpi: KpiMetrics): CoverageGateResult {
    if (!isValidKpi(kpi)) {
      return { allowed: false, reason: 'INVALID_KPI_DATA' };
    }

    if (kpi.dataCoveragePercent < MIN_COVERAGE_PERCENT) {
      return { allowed: false, reason: 'COVERAGE_BELOW_80_PERCENT' };
    }

    if (kpi.dataQualityWarning && kpi.sampleCount < MIN_TRUSTED_SAMPLES) {
      return { allowed: false, reason: 'INSUFFICIENT_TRUSTED_SAMPLES' };
    }

    if (kpi.configRevision === null) {
      return { allowed: false, reason: 'CONFIG_REVISION_UNAVAILABLE' };
    }

    return { allowed: true };
  }

  /** Returns false for missing telemetry or any unavailable liveness dependency. */
  async checkDeviceOnline(
    deviceId: string,
    now = new Date(),
  ): Promise<boolean> {
    if (
      typeof deviceId !== 'string' ||
      !deviceId.trim() ||
      Number.isNaN(now.getTime())
    ) {
      return false;
    }

    try {
      const queryApi = this.influxDbService.getQueryApi();
      const rawBucket = this.configService.get('INFLUXDB_BUCKET')?.trim();
      if (!queryApi || !rawBucket) return false;

      const cutoff = new Date(now.getTime() - DEVICE_ONLINE_WINDOW_MS);
      const flux = buildDeviceLastSeenQuery(deviceId, rawBucket, cutoff, now);
      const rows = await queryApi.collectRows<Record<string, unknown>>(flux);
      const lastSeen = parseTelemetryTimestamp(rows[0]?._time);
      return lastSeen !== null && lastSeen > cutoff && lastSeen <= now;
    } catch {
      return false;
    }
  }

  /** Returns rolling, sample-weighted KPI data or null when no valid data exists. */
  async getKpiForDevice(
    deviceId: string,
    windowHours = HOURS_PER_DAY,
    now = new Date(),
  ): Promise<KpiMetrics | null> {
    validateKpiQuery(deviceId, windowHours, now);

    const queryApi = this.influxDbService.getQueryApi();
    const analyticsBucket = this.configService
      .get('INFLUXDB_ANALYTICS_BUCKET')
      ?.trim();
    if (!queryApi || !analyticsBucket) {
      throw new ServiceUnavailableException(
        'InfluxDB analytics query is unavailable',
      );
    }

    const windowStart = new Date(
      now.getTime() - windowHours * SECONDS_PER_HOUR * 1_000,
    );
    const flux = buildKpiQuery(deviceId, analyticsBucket, windowStart, now);
    const rows = await queryKpiRows(queryApi, flux);
    if (rows === null) return null;
    return aggregateKpiRows(deviceId, rows, windowStart, now, windowHours);
  }
}

async function queryKpiRows(
  queryApi: QueryApi,
  flux: string,
): Promise<HourlyKpiRow[] | null> {
  try {
    const rawRows = await queryApi.collectRows<Record<string, unknown>>(flux);
    const rows: HourlyKpiRow[] = [];
    for (const rawRow of rawRows) {
      const row = toHourlyKpiRow(rawRow);
      // A mixed valid/corrupt response is not trustworthy. Do not silently
      // discard corrupt hourly rows and derive a recommendation from a subset.
      if (row === null) return null;
      rows.push(row);
    }
    return rows;
  } catch {
    throw new ServiceUnavailableException('InfluxDB analytics query failed');
  }
}

function aggregateKpiRows(
  deviceId: string,
  rows: HourlyKpiRow[],
  windowStart: Date,
  windowEnd: Date,
  windowHours: number,
): KpiMetrics | null {
  if (rows.length === 0) return null;

  const total = accumulateKpiRows(rows);
  if (total === null || !validateKpiWindowTotals(total, windowHours)) {
    return null;
  }

  return buildKpiMetrics(
    deviceId,
    windowStart,
    windowEnd,
    windowHours,
    total,
    resolveConfigRevision(rows),
  );
}

function accumulateKpiRows(rows: HourlyKpiRow[]): KpiTotal | null {
  const total = emptyKpiTotal();
  for (const row of rows) {
    if (!addKpiRow(total, row)) return null;
  }
  return total;
}

function validateKpiWindowTotals(
  total: KpiTotal,
  windowHours: number,
): boolean {
  const expectedWindowSamples = windowHours * SAMPLES_PER_HOUR;
  const maxWindowDurationSec = windowHours * SECONDS_PER_HOUR;
  return (
    total.sampleCount > 0 &&
    total.expectedSamples > 0 &&
    total.sampleCount <= total.validSamples &&
    total.sampleCount <= total.expectedSamples &&
    total.expectedSamples <= expectedWindowSamples &&
    total.validSamples <= total.expectedSamples &&
    total.validSamples <= expectedWindowSamples &&
    total.lampOnDurationSec <= maxWindowDurationSec &&
    total.overshootDurationSec <= maxWindowDurationSec &&
    total.undershootDurationSec <= maxWindowDurationSec
  );
}

function resolveConfigRevision(rows: HourlyKpiRow[]): number | null {
  const revisions = new Set<number>();
  for (const row of rows) {
    if (row.configRevision === null) return null;
    revisions.add(row.configRevision);
  }
  return revisions.size === 1 ? [...revisions][0] : null;
}

function buildKpiMetrics(
  deviceId: string,
  windowStart: Date,
  windowEnd: Date,
  windowHours: number,
  total: KpiTotal,
  configRevision: number | null,
): KpiMetrics {
  const expectedWindowSamples = windowHours * SAMPLES_PER_HOUR;
  return {
    deviceId,
    windowStart,
    windowEnd,
    // Sum squared errors and samples before calculating RMSE; hourly RMSEs are
    // not statistically composable by averaging.
    tempRmse: Math.sqrt(total.tempSquaredError / total.sampleCount),
    humidRmse: Math.sqrt(total.humidSquaredError / total.sampleCount),
    mistSwitchCountPerHour: total.mistSwitchCount / windowHours,
    lampDutyCyclePercent:
      (total.lampOnDurationSec / (windowHours * SECONDS_PER_HOUR)) * 100,
    lampAvgOnDurationSec:
      total.lampSessionCount === 0
        ? 0
        : total.lampOnDurationSec / total.lampSessionCount,
    overshootDurationSec: total.overshootDurationSec,
    undershootDurationSec: total.undershootDurationSec,
    dataCoveragePercent: (total.validSamples / expectedWindowSamples) * 100,
    sampleCount: total.sampleCount,
    configRevision,
    dataQualityWarning: total.dataQualityWarning || configRevision === null,
  };
}

function emptyKpiTotal(): KpiTotal {
  return {
    sampleCount: 0,
    tempSquaredError: 0,
    humidSquaredError: 0,
    mistSwitchCount: 0,
    lampOnDurationSec: 0,
    lampSessionCount: 0,
    overshootDurationSec: 0,
    undershootDurationSec: 0,
    expectedSamples: 0,
    validSamples: 0,
    dataQualityWarning: false,
  };
}

function toHourlyKpiRow(row: Record<string, unknown>): HourlyKpiRow | null {
  const values = parseHourlyNumericValues(row);
  if (values === null || !validateHourlyKpiValues(values)) return null;

  return buildHourlyKpiRow(values, row);
}

function parseHourlyNumericValues(
  row: Record<string, unknown>,
): HourlyNumericValues | null {
  const values = {
    sampleCount: toFiniteNumber(row.sample_count),
    tempSquaredError: toFiniteNumber(row.sum_squared_error_temp),
    humidSquaredError: toFiniteNumber(row.sum_squared_error_humid),
    mistSwitchCount: toFiniteNumber(row.mist_switch_count),
    lampOnDurationSec: toFiniteNumber(row.lamp_on_duration_s),
    lampSessionCount: toFiniteNumber(row.lamp_session_count),
    overshootDurationSec: toFiniteNumber(row.overshoot_temp_duration_s),
    undershootDurationSec: toFiniteNumber(row.undershoot_temp_duration_s),
    expectedSamples: toFiniteNumber(row.expected_samples),
    validSamples: toFiniteNumber(row.valid_samples),
  };
  return Object.values(values).every(isNonNegativeFiniteNumber)
    ? (values as HourlyNumericValues)
    : null;
}

function validateHourlyKpiValues(values: HourlyNumericValues): boolean {
  const {
    sampleCount,
    tempSquaredError,
    humidSquaredError,
    mistSwitchCount,
    lampOnDurationSec,
    lampSessionCount,
    overshootDurationSec,
    undershootDurationSec,
    expectedSamples,
    validSamples,
  } = values;
  if (
    !Number.isInteger(sampleCount) ||
    !Number.isInteger(mistSwitchCount) ||
    !Number.isInteger(lampSessionCount) ||
    !Number.isInteger(expectedSamples) ||
    !Number.isInteger(validSamples) ||
    sampleCount > SAMPLES_PER_HOUR ||
    sampleCount > validSamples ||
    sampleCount > expectedSamples ||
    expectedSamples < 1 ||
    expectedSamples > SAMPLES_PER_HOUR ||
    validSamples > expectedSamples ||
    mistSwitchCount > sampleCount ||
    lampSessionCount > sampleCount ||
    lampOnDurationSec > SECONDS_PER_HOUR ||
    overshootDurationSec > SECONDS_PER_HOUR ||
    undershootDurationSec > SECONDS_PER_HOUR ||
    tempSquaredError > MAX_SAFE_METRIC ||
    humidSquaredError > MAX_SAFE_METRIC
  ) {
    return false;
  }

  return true;
}

function buildHourlyKpiRow(
  values: HourlyNumericValues,
  row: Record<string, unknown>,
): HourlyKpiRow {
  const revision = parseRevision(row.config_revision);
  return {
    ...values,
    configRevision: revision,
    dataQualityWarning:
      revision === null ||
      (typeof row.data_quality === 'string' && row.data_quality !== 'good'),
  };
}

function buildKpiQuery(
  deviceId: string,
  analyticsBucket: string,
  windowStart: Date,
  windowEnd: Date,
): string {
  const escapedDeviceId = escapeFluxString(deviceId);
  return `from(bucket: "${escapeFluxString(analyticsBucket)}")
  |> range(start: time(v: "${windowStart.toISOString()}"), stop: time(v: "${windowEnd.toISOString()}"))
  |> filter(fn: (r) => r["_measurement"] == "kpi_metrics_1h")
  |> filter(fn: (r) => r["device_id"] == "${escapedDeviceId}")
  |> pivot(rowKey: ["_time", "device_id", "control_source", "config_revision"], columnKey: ["_field"], valueColumn: "_value")`;
}

function buildDeviceLastSeenQuery(
  deviceId: string,
  rawBucket: string,
  windowStart: Date,
  windowEnd: Date,
): string {
  return `from(bucket: "${escapeFluxString(rawBucket)}")
  |> range(start: time(v: "${windowStart.toISOString()}"), stop: time(v: "${windowEnd.toISOString()}"))
  |> filter(fn: (r) => r["_measurement"] == "controller_history")
  |> filter(fn: (r) => r["device_id"] == "${escapeFluxString(deviceId)}")
  |> keep(columns: ["_time"])
  |> sort(columns: ["_time"], desc: true)
  |> limit(n: 1)`;
}

export function escapeFluxString(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

function validateKpiQuery(
  deviceId: string,
  windowHours: number,
  now: Date,
): void {
  if (!deviceId.trim()) throw new TypeError('deviceId must not be empty');
  if (
    !Number.isInteger(windowHours) ||
    windowHours < 1 ||
    windowHours > MAX_WINDOW_HOURS
  ) {
    throw new RangeError(
      `windowHours must be an integer between 1 and ${MAX_WINDOW_HOURS}`,
    );
  }
  if (Number.isNaN(now.getTime()))
    throw new TypeError('now must be a valid date');
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_SAFE_METRIC
  );
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseRevision(value: unknown): number | null {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/u.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseTelemetryTimestamp(value: unknown): Date | null {
  const timestamp =
    value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function addKpiRow(total: KpiTotal, row: HourlyKpiRow): boolean {
  const numericKeys: Array<keyof Omit<KpiTotal, 'dataQualityWarning'>> = [
    'sampleCount',
    'tempSquaredError',
    'humidSquaredError',
    'mistSwitchCount',
    'lampOnDurationSec',
    'lampSessionCount',
    'overshootDurationSec',
    'undershootDurationSec',
    'expectedSamples',
    'validSamples',
  ];
  for (const key of numericKeys) {
    const next = total[key] + row[key];
    if (!Number.isFinite(next) || next > MAX_SAFE_METRIC) return false;
    total[key] = next;
  }
  total.dataQualityWarning ||= row.dataQualityWarning;
  return total.validSamples <= total.expectedSamples;
}

function isValidKpi(kpi: KpiMetrics): boolean {
  return (
    typeof kpi.deviceId === 'string' &&
    kpi.deviceId.trim().length > 0 &&
    kpi.windowStart instanceof Date &&
    kpi.windowEnd instanceof Date &&
    Number.isFinite(kpi.windowStart.getTime()) &&
    Number.isFinite(kpi.windowEnd.getTime()) &&
    kpi.windowEnd.getTime() > kpi.windowStart.getTime() &&
    isNonNegativeFiniteNumber(kpi.tempRmse) &&
    isNonNegativeFiniteNumber(kpi.humidRmse) &&
    isNonNegativeFiniteNumber(kpi.mistSwitchCountPerHour) &&
    isNonNegativeFiniteNumber(kpi.lampAvgOnDurationSec) &&
    isNonNegativeFiniteNumber(kpi.overshootDurationSec) &&
    isNonNegativeFiniteNumber(kpi.undershootDurationSec) &&
    Number.isFinite(kpi.lampDutyCyclePercent) &&
    kpi.lampDutyCyclePercent >= 0 &&
    kpi.lampDutyCyclePercent <= 100 &&
    Number.isFinite(kpi.dataCoveragePercent) &&
    kpi.dataCoveragePercent >= 0 &&
    kpi.dataCoveragePercent <= 100 &&
    Number.isSafeInteger(kpi.sampleCount) &&
    kpi.sampleCount >= 0 &&
    typeof kpi.dataQualityWarning === 'boolean' &&
    (kpi.configRevision === null ||
      (Number.isSafeInteger(kpi.configRevision) && kpi.configRevision >= 0))
  );
}
