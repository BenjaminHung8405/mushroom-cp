import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  InfluxDB,
  QueryApi,
  WriteApi,
} from '@influxdata/influxdb-client';
import type { OfflineSyncBurst } from '../mqtt/offline-sync';
import { OfflineCanonicalNormalizerService } from '../influx/services/offline-canonical-normalizer.service';

@Injectable()
export class OfflineSyncService implements OnModuleDestroy {
  private readonly logger = new Logger(OfflineSyncService.name);
  private readonly influxUrl = process.env.INFLUXDB_URL ?? '';
  private readonly influxToken = process.env.INFLUXDB_TOKEN ?? '';
  private readonly influxOrg = process.env.INFLUXDB_ORG ?? '';
  private readonly influxBucket = process.env.INFLUXDB_BUCKET ?? '';
  private readonly writeApi: WriteApi | null;
  private readonly queryApi: QueryApi | null;

  constructor(private readonly normalizer: OfflineCanonicalNormalizerService = new OfflineCanonicalNormalizerService()) {
    if (
      !this.influxUrl ||
      !this.influxToken ||
      !this.influxOrg ||
      !this.influxBucket
    ) {
      this.logger.error(
        'InfluxDB is not configured; offline sync persistence is unavailable.',
      );
      this.writeApi = null;
      this.queryApi = null;
      return;
    }
    const influx = new InfluxDB({
      url: this.influxUrl,
      token: this.influxToken,
    });
    this.writeApi = influx.getWriteApi(this.influxOrg, this.influxBucket, 'ms');
    this.queryApi = influx.getQueryApi(this.influxOrg);
  }

  async onModuleDestroy(): Promise<void> {
    await this.writeApi?.close();
  }

  /** Writes an already validated framed MQTT burst. Failure is propagated so firmware does not receive an ACK. */
  async writeBurst(
    deviceId: string,
    burst: OfflineSyncBurst,
    receivedAt: Date,
  ): Promise<void> {
    if (!this.writeApi)
      throw new ServiceUnavailableException(
        'InfluxDB offline-sync writer is unavailable',
      );

    this.normalizer.writeBurst(this.writeApi, deviceId, burst, receivedAt);
    await this.writeApi.flush();
    this.logger.log(
      `Influx offline burst persisted device=${deviceId} boot=${burst.bootCount} chunk=${burst.chunkIndex} records=${burst.records.length}`,
    );
  }

  /**
   * Live telemetry history for the Offline Monitoring dashboard.
   *
   * Reads the `controller_history` measurement written by
   * `ControlHistoryInfluxWriter` from the live MQTT telemetry stream. Offline
   * sync bursts are still persisted by `writeBurst()` into the
   * `environment_telemetry`/`actuator_events`/`system_status` measurements, but
   * this endpoint intentionally does not merge them; offline-burst history, if
   * needed later, belongs in a separate endpoint with explicit provenance.
   */
  async getHistory(
    deviceId: string,
    from: Date,
    to: Date,
  ): Promise<OfflineHistoryPoint[]> {
    if (!this.queryApi || !this.influxBucket) {
      throw new ServiceUnavailableException(
        'InfluxDB history query is unavailable',
      );
    }
    if (!isFiniteDate(from) || !isFiniteDate(to) || from >= to) return [];

    const escapedDeviceId = escapeFluxString(deviceId);
    const flux = `from(bucket: "${escapeFluxString(this.influxBucket)}")
      |> range(start: time(v: "${from.toISOString()}"), stop: time(v: "${to.toISOString()}"))
      |> filter(fn: (r) => r["device_id"] == "${escapedDeviceId}")
      |> filter(fn: (r) => r["_measurement"] == "controller_history")
      |> pivot(rowKey: ["_time", "device_id", "data_quality", "control_source"], columnKey: ["_field"], valueColumn: "_value")
      |> keep(columns: ["_time", "data_quality", "temperature_c", "humidity_percent", "mist_state", "lamp_state"])
      |> sort(columns: ["_time"])`;

    try {
      const rows =
        await this.queryApi.collectRows<Record<string, unknown>>(flux);
      return rows
        .map(toOfflineHistoryPoint)
        .filter((row): row is OfflineHistoryPoint => row !== null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Influx history query failed for ${deviceId}: ${message}`,
      );
      throw new ServiceUnavailableException('InfluxDB history query failed');
    }
  }

}

export interface OfflineHistoryPoint {
  time: string;
  dataQuality: 'trusted' | 'degraded';
  bootCount: number | null;
  temperature: number | null;
  humidity: number | null;
  mistState: boolean | null;
  lampState: boolean | null;
  deltaTimeS: number | null;
  fuzzyTempDemand: number | null;
  fuzzyHumidDemand: number | null;
}

export function toOfflineHistoryPoint(
  row: Record<string, unknown>,
): OfflineHistoryPoint | null {
  const time = typeof row._time === 'string' ? row._time : '';
  if (!time || Number.isNaN(new Date(time).getTime())) return null;
  return {
    time,
    // `controller_history` uses `good` for trustworthy samples; every other
    // state (`degraded`, `missing_target`) is reported as degraded to the UI.
    dataQuality: row.data_quality === 'good' ? 'trusted' : 'degraded',
    bootCount: finiteInteger(row.boot_count),
    temperature: finiteNumber(row.temperature_c),
    humidity: finiteNumber(row.humidity_percent),
    mistState: typeof row.mist_state === 'boolean' ? row.mist_state : null,
    lampState: typeof row.lamp_state === 'boolean' ? row.lamp_state : null,
    deltaTimeS: finiteInteger(row.delta_time_s),
    fuzzyTempDemand: finiteNumber(row.fuzzy_temp_demand),
    fuzzyHumidDemand: finiteNumber(row.fuzzy_humid_demand),
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function finiteInteger(value: unknown): number | null {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
function isFiniteDate(value: Date): boolean {
  return value instanceof Date && !Number.isNaN(value.getTime());
}
function escapeFluxString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
