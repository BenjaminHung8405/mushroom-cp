import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { QueryApi } from '@influxdata/influxdb-client';
import { InfluxDbService } from '../../influx/services/influx-db.service';
import { ConfigService } from '../../influx/services/config.service';
import type { KpiMetrics } from '../interfaces/kpi-metrics.interface';

const HOURS_PER_DAY = 24;
const SECONDS_PER_HOUR = 3_600;
const MAX_WINDOW_HOURS = 168;

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

@Injectable()
export class ControlAnalyticsService {
  constructor(
    private readonly influxDbService: InfluxDbService,
    private readonly configService: ConfigService,
  ) {}

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

    const windowStart = new Date(now.getTime() - windowHours * SECONDS_PER_HOUR * 1_000);
    const flux = buildKpiQuery(deviceId, analyticsBucket, windowStart, now);
    const rows = await queryKpiRows(queryApi, flux);
    return aggregateKpiRows(deviceId, rows, windowStart, now, windowHours);
  }
}

async function queryKpiRows(
  queryApi: QueryApi,
  flux: string,
): Promise<HourlyKpiRow[]> {
  try {
    const rawRows = await queryApi.collectRows<Record<string, unknown>>(flux);
    return rawRows
      .map(toHourlyKpiRow)
      .filter((row): row is HourlyKpiRow => row !== null);
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

  const total = rows.reduce(
    (accumulator, row) => ({
      sampleCount: accumulator.sampleCount + row.sampleCount,
      tempSquaredError: accumulator.tempSquaredError + row.tempSquaredError,
      humidSquaredError: accumulator.humidSquaredError + row.humidSquaredError,
      mistSwitchCount: accumulator.mistSwitchCount + row.mistSwitchCount,
      lampOnDurationSec: accumulator.lampOnDurationSec + row.lampOnDurationSec,
      lampSessionCount: accumulator.lampSessionCount + row.lampSessionCount,
      overshootDurationSec:
        accumulator.overshootDurationSec + row.overshootDurationSec,
      undershootDurationSec:
        accumulator.undershootDurationSec + row.undershootDurationSec,
      expectedSamples: accumulator.expectedSamples + row.expectedSamples,
      validSamples: accumulator.validSamples + row.validSamples,
      dataQualityWarning:
        accumulator.dataQualityWarning || row.dataQualityWarning,
    }),
    emptyKpiTotal(),
  );
  if (total.sampleCount === 0 || total.expectedSamples === 0) return null;

  const revisions = new Set(
    rows.flatMap((row) => (row.configRevision === null ? [] : [row.configRevision])),
  );
  const configRevision =
    revisions.size === 1 && rows.every((row) => row.configRevision !== null)
      ? [...revisions][0]
      : null;

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
    dataCoveragePercent: (total.validSamples / total.expectedSamples) * 100,
    sampleCount: total.sampleCount,
    configRevision,
    dataQualityWarning: total.dataQualityWarning || configRevision === null,
  };
}

function emptyKpiTotal() {
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
  const requiredValues = [
    row.sample_count,
    row.sum_squared_error_temp,
    row.sum_squared_error_humid,
    row.mist_switch_count,
    row.lamp_on_duration_s,
    row.lamp_session_count,
    row.overshoot_temp_duration_s,
    row.undershoot_temp_duration_s,
    row.expected_samples,
    row.valid_samples,
  ].map(toFiniteNumber);
  if (!requiredValues.every(isNonNegativeFiniteNumber)) return null;

  const revision = parseRevision(row.config_revision);
  return {
    sampleCount: requiredValues[0],
    tempSquaredError: requiredValues[1],
    humidSquaredError: requiredValues[2],
    mistSwitchCount: requiredValues[3],
    lampOnDurationSec: requiredValues[4],
    lampSessionCount: requiredValues[5],
    overshootDurationSec: requiredValues[6],
    undershootDurationSec: requiredValues[7],
    expectedSamples: requiredValues[8],
    validSamples: requiredValues[9],
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

export function escapeFluxString(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

function validateKpiQuery(deviceId: string, windowHours: number, now: Date): void {
  if (!deviceId.trim()) throw new TypeError('deviceId must not be empty');
  if (!Number.isInteger(windowHours) || windowHours < 1 || windowHours > MAX_WINDOW_HOURS) {
    throw new RangeError(`windowHours must be an integer between 1 and ${MAX_WINDOW_HOURS}`);
  }
  if (Number.isNaN(now.getTime())) throw new TypeError('now must be a valid date');
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
