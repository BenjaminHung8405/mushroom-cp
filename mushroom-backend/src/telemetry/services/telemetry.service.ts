import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { Subscription, Subject } from 'rxjs';
import { toZonedTime } from 'date-fns-tz';
import { MqttService, TelemetryEvent } from '../../mqtt/mqtt.service';
import { BatchService, BatchContext } from '../../batch/services/batch.service';
import { DatabaseService } from '../../database/database.service';
import { DeviceRegistryService } from '../../device/device-registry.service';

export interface TelemetrySnapshot {
  deviceId: string;
  houseId: string;
  time: Date;
  batchId: string | null;
  cropDayInt: number;
  humidityMeasured: number | null;
  temperatureMeasured: number | null;
  co2Measured: number | null;
  humiditySetpoint: number | null;
  temperatureSetpoint: number | null;
  humidityErrorDelta: number | null;
  temperatureErrorDelta: number | null;
  mistGeneratorActive: boolean;
  convectionFanActive: boolean;
  heatingLampActive: boolean;
  middayBlackoutActive: boolean;
}

export interface TelemetryLogDbRow {
  time: string | Date;
  batchId: string;
  houseId: string;
  cropDayInt: number;
  humidityMeasured: string | number | null;
  temperatureMeasured: string | number | null;
  co2Measured: number | null;
  humiditySetpoint: string | number | null;
  temperatureSetpoint: string | number | null;
  humidityErrorDelta: string | number | null;
  temperatureErrorDelta: string | number | null;
  mistGeneratorActive: boolean;
  convectionFanActive: boolean;
  heatingLampActive: boolean;
  middayBlackoutActive: boolean;
}

@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryService.name);
  private telemetrySubscription: Subscription | null = null;
  readonly telemetryUpdates$ = new Subject<TelemetrySnapshot>();
  /** Keyed by deviceId (MQTT identity), never by houseId. */
  private readonly latestCache = new Map<string, TelemetrySnapshot>();

  constructor(
    private readonly mqttService: MqttService,
    private readonly batchService: BatchService,
    private readonly db: DatabaseService,
    private readonly registry: DeviceRegistryService,
  ) {}

  onModuleInit(): void {
    this.telemetrySubscription = this.mqttService.telemetry$.subscribe(
      (event) => {
        this.processTelemetry(event).catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Unhandled error in telemetry stream subscriber: ${errMsg}`,
          );
        });
      },
    );
    this.logger.log(
      'TelemetryService initialized and subscribed to telemetry stream.',
    );
  }

  onModuleDestroy(): void {
    if (this.telemetrySubscription) {
      this.telemetrySubscription.unsubscribe();
      this.logger.log('Unsubscribed from MQTT telemetry stream.');
    }
  }

  /**
   * Closed-loop observation + advisory setpoint dispatch.
   * Edge firmware remains safety authority for relays.
   */
  async processTelemetry(event: TelemetryEvent): Promise<void> {
    const timestamp = event.receivedAt ?? new Date(event.timestamp);
    const deviceId = event.deviceId;
    const houseId = event.houseId;

    if (!deviceId || !houseId) {
      this.logger.error(
        `Received telemetry without deviceId/houseId: ${JSON.stringify(event)}`,
      );
      return;
    }

    let controlActions = {
      mist_generator_active: false,
      convection_fan_active: false,
      heating_lamp_active: false,
      midday_blackout_active: false,
    };
    let context: BatchContext | null = null;

    try {
      context = await this.batchService.getBatchContext(houseId, timestamp);

      if (context.batchId === null) {
        await this.saveTelemetryLog(
          houseId,
          event,
          context,
          controlActions,
          timestamp,
        );
        this.updateCache(
          deviceId,
          houseId,
          event,
          context,
          controlActions,
          timestamp,
        );
      } else {
        const outputs = this.calculateControlOutputs(event, context, timestamp);
        controlActions = {
          mist_generator_active: outputs.mistGeneratorActive,
          convection_fan_active: outputs.convectionFanActive,
          heating_lamp_active: outputs.heatingLampActive,
          midday_blackout_active: outputs.middayBlackoutActive,
        };
        await this.saveTelemetryLog(
          houseId,
          event,
          context,
          controlActions,
          timestamp,
        );
        this.updateCache(
          deviceId,
          houseId,
          event,
          context,
          controlActions,
          timestamp,
        );
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Critical error processing telemetry for device ${deviceId}: ${errMsg}`,
      );
      // Observed emergency recommendation only — the Core 1 fuzzy/TPC pipeline owns SSRs.
      controlActions = {
        mist_generator_active: false,
        convection_fan_active: true,
        heating_lamp_active: false,
        midday_blackout_active: false,
      };
    } finally {
      try {
        const targetTemp = context?.targetTemp ?? 30;
        const targetHumid = context?.targetHumid ?? 80;
        await this.mqttService.dispatchSetpoint(deviceId, {
          temperatureSetpoint: targetTemp,
          humiditySetpoint: targetHumid,
          co2Setpoint: 1000,
          thermal_shock_protection: context?.thermalShockProtection ?? true,
          thermal_shock_start: context?.thermalShockStart?.slice(0, 5) ?? '11:00',
          thermal_shock_end: context?.thermalShockEnd?.slice(0, 5) ?? '13:30',
          control_mode: 'fuzzy_tpc',
          setpoint_ttl_sec: 120,
        });
      } catch (dispatchError: unknown) {
        const dispatchErrMsg =
          dispatchError instanceof Error
            ? dispatchError.message
            : String(dispatchError);
        this.logger.error(
          `Failed to dispatch advisory setpoint to '${deviceId}': ${dispatchErrMsg}`,
        );
      }
    }
  }

  async getLatestTelemetry(deviceId: string): Promise<TelemetrySnapshot | null> {
    const cached = this.latestCache.get(deviceId);
    if (cached) {
      return cached;
    }

    let record = this.registry.get(deviceId);
    if (!record) {
      record = (await this.registry.refreshOne(deviceId)) ?? undefined;
    }
    if (!record || !record.enabled) {
      return null;
    }

    try {
      const queryText = `
        SELECT
          time,
          batch_id AS "batchId",
          house_id AS "houseId",
          crop_day_int AS "cropDayInt",
          humidity_measured AS "humidityMeasured",
          temperature_measured AS "temperatureMeasured",
          co2_measured AS "co2Measured",
          humidity_setpoint AS "humiditySetpoint",
          temperature_setpoint AS "temperatureSetpoint",
          humidity_error_delta AS "humidityErrorDelta",
          temperature_error_delta AS "temperatureErrorDelta",
          mist_generator_active AS "mistGeneratorActive",
          convection_fan_active AS "convectionFanActive",
          heating_lamp_active AS "heatingLampActive",
          midday_blackout_active AS "middayBlackoutActive"
        FROM telemetry_logs
        WHERE house_id = $1
        ORDER BY time DESC
        LIMIT 1;
      `;
      const res = await this.db.query<TelemetryLogDbRow>(queryText, [
        record.houseId,
      ]);
      const row = res.rows[0];
      if (!row) {
        return null;
      }

      const snapshot: TelemetrySnapshot = {
        deviceId,
        houseId: record.houseId,
        time: new Date(row.time),
        batchId: row.batchId === 'idle' ? null : row.batchId,
        cropDayInt: row.cropDayInt,
        humidityMeasured:
          row.humidityMeasured != null ? Number(row.humidityMeasured) : null,
        temperatureMeasured:
          row.temperatureMeasured != null
            ? Number(row.temperatureMeasured)
            : null,
        co2Measured: row.co2Measured != null ? Number(row.co2Measured) : null,
        humiditySetpoint:
          row.humiditySetpoint != null ? Number(row.humiditySetpoint) : null,
        temperatureSetpoint:
          row.temperatureSetpoint != null
            ? Number(row.temperatureSetpoint)
            : null,
        humidityErrorDelta:
          row.humidityErrorDelta != null
            ? Number(row.humidityErrorDelta)
            : null,
        temperatureErrorDelta:
          row.temperatureErrorDelta != null
            ? Number(row.temperatureErrorDelta)
            : null,
        mistGeneratorActive: Boolean(row.mistGeneratorActive),
        convectionFanActive: Boolean(row.convectionFanActive),
        heatingLampActive: Boolean(row.heatingLampActive),
        middayBlackoutActive: Boolean(row.middayBlackoutActive),
      };

      this.latestCache.set(deviceId, snapshot);
      return snapshot;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to load latest telemetry from DB for device ${deviceId}: ${msg}`,
      );
      return null;
    }
  }

  calculateControlOutputs(
    event: TelemetryEvent,
    context: BatchContext,
    timestamp: Date,
  ): {
    mistGeneratorActive: boolean;
    convectionFanActive: boolean;
    heatingLampActive: boolean;
    middayBlackoutActive: boolean;
  } {
    const tempAir = event.temp_air;
    const humidityAir = event.humidity_air;
    const co2Level = event.co2_level;

    const zonedTime = toZonedTime(timestamp, 'Asia/Ho_Chi_Minh');
    const minutesSinceMidnight =
      zonedTime.getHours() * 60 + zonedTime.getMinutes();

    let isBlackoutActive = false;
    if (context.thermalShockProtection) {
      const startMin = context.thermalShockStart
        ? this.parseTimeToMinutes(context.thermalShockStart)
        : 660;
      const endMin = context.thermalShockEnd
        ? this.parseTimeToMinutes(context.thermalShockEnd)
        : 810;
      if (minutesSinceMidnight >= startMin && minutesSinceMidnight <= endMin) {
        isBlackoutActive = true;
      }
    }

    let mistGeneratorActive = false;
    if (!isBlackoutActive && humidityAir !== null && humidityAir !== undefined) {
      mistGeneratorActive = humidityAir < context.targetHumid;
    }

    let convectionFanActive = false;
    if (tempAir !== null && tempAir !== undefined && tempAir > context.targetTemp) {
      convectionFanActive = true;
    }
    if (co2Level !== null && co2Level !== undefined && co2Level > 1000) {
      convectionFanActive = true;
    }

    let heatingLampActive = false;
    if (tempAir !== null && tempAir !== undefined) {
      heatingLampActive = tempAir < context.tempOptimalMin;
    }

    return {
      mistGeneratorActive,
      convectionFanActive,
      heatingLampActive,
      middayBlackoutActive: isBlackoutActive,
    };
  }

  private parseTimeToMinutes(timeStr: string): number {
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
  }

  private calculateDelta(
    setpoint: number | null,
    measured: number | null,
  ): number | null {
    if (setpoint === null || measured === null) return null;
    return parseFloat((setpoint - measured).toFixed(1));
  }

  private async saveTelemetryLog(
    houseId: string,
    event: TelemetryEvent,
    context: BatchContext,
    controlActions: {
      mist_generator_active: boolean;
      convection_fan_active: boolean;
      heating_lamp_active: boolean;
      midday_blackout_active: boolean;
    },
    timestamp: Date,
  ): Promise<void> {
    const humidityMeasured = event.humidity_air;
    const temperatureMeasured = event.temp_air;
    const co2Measured = event.co2_level;
    const humiditySetpoint = context.batchId ? context.targetHumid : null;
    const temperatureSetpoint = context.batchId ? context.targetTemp : null;

    const queryText = `
      INSERT INTO telemetry_logs (
        time, batch_id, house_id, crop_day_int,
        humidity_measured, temperature_measured, co2_measured,
        humidity_setpoint, temperature_setpoint,
        humidity_error_delta, temperature_error_delta,
        mist_generator_active, convection_fan_active, heating_lamp_active,
        midday_blackout_active
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9,
        $10, $11,
        $12, $13, $14,
        $15
      );
    `;
    const params = [
      timestamp,
      context.batchId ?? 'idle',
      houseId,
      context.cropDay,
      humidityMeasured,
      temperatureMeasured,
      co2Measured,
      humiditySetpoint,
      temperatureSetpoint,
      this.calculateDelta(humiditySetpoint, humidityMeasured),
      this.calculateDelta(temperatureSetpoint, temperatureMeasured),
      controlActions.mist_generator_active,
      controlActions.convection_fan_active,
      controlActions.heating_lamp_active,
      controlActions.midday_blackout_active,
    ];
    await this.db.query(queryText, params);
  }

  private updateCache(
    deviceId: string,
    houseId: string,
    event: TelemetryEvent,
    context: BatchContext,
    controlActions: {
      mist_generator_active: boolean;
      convection_fan_active: boolean;
      heating_lamp_active: boolean;
      midday_blackout_active: boolean;
    },
    timestamp: Date,
  ): void {
    const humidityMeasured = event.humidity_air;
    const temperatureMeasured = event.temp_air;
    const co2Measured = event.co2_level;
    const humiditySetpoint = context.batchId ? context.targetHumid : null;
    const temperatureSetpoint = context.batchId ? context.targetTemp : null;

    const snapshot: TelemetrySnapshot = {
      deviceId,
      houseId,
      time: timestamp,
      batchId: context.batchId,
      cropDayInt: context.cropDay,
      humidityMeasured,
      temperatureMeasured,
      co2Measured,
      humiditySetpoint,
      temperatureSetpoint,
      humidityErrorDelta: this.calculateDelta(humiditySetpoint, humidityMeasured),
      temperatureErrorDelta: this.calculateDelta(
        temperatureSetpoint,
        temperatureMeasured,
      ),
      mistGeneratorActive: controlActions.mist_generator_active,
      convectionFanActive: controlActions.convection_fan_active,
      heatingLampActive: controlActions.heating_lamp_active,
      middayBlackoutActive: controlActions.midday_blackout_active,
    };

    this.latestCache.set(deviceId, snapshot);
    this.telemetryUpdates$.next(snapshot);
  }

  /**
   * Downsampled history via TimescaleDB time_bucket (Asia/Ho_Chi_Minh).
   * Route param is deviceId; query filters by mapped house_id.
   */
  async getTelemetryHistory(
    deviceId: string,
    from: Date,
    to: Date,
    clientBucket?: string,
  ): Promise<TelemetrySnapshot[]> {
    if (!(from instanceof Date) || Number.isNaN(from.getTime())) {
      throw new BadRequestException('Invalid from date');
    }
    if (!(to instanceof Date) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Invalid to date');
    }
    if (from >= to) {
      throw new BadRequestException('from must be before to');
    }

    const rangeMs = to.getTime() - from.getTime();
    const maxRangeMs = 7 * 24 * 60 * 60 * 1000;
    if (rangeMs > maxRangeMs) {
      throw new BadRequestException('History range cannot exceed 7 days');
    }

    let record = this.registry.get(deviceId);
    if (!record) {
      record = (await this.registry.refreshOne(deviceId)) ?? undefined;
    }
    if (!record) {
      throw new BadRequestException(`Unknown device '${deviceId}'`);
    }
    const houseId = record.houseId;

    const defaultBucket =
      rangeMs <= 3_600_000
        ? '1 minute'
        : rangeMs <= 21_600_000
          ? '5 minutes'
          : rangeMs <= 86_400_000
            ? '15 minutes'
            : '1 hour';

    const allowed = new Set([
      '1 minute',
      '5 minutes',
      '15 minutes',
      '1 hour',
      '1 day',
    ]);
    const bucket =
      clientBucket && allowed.has(clientBucket) ? clientBucket : defaultBucket;

    // time_bucket defaults to UTC; force Asia/Ho_Chi_Minh so day boundaries match farm local time.
    const queryText = `
      SELECT
        time_bucket($1::interval, time AT TIME ZONE 'Asia/Ho_Chi_Minh') AS bucket,
        house_id AS "houseId",
        AVG(temperature_measured)::float AS "temperatureMeasured",
        AVG(humidity_measured)::float AS "humidityMeasured",
        AVG(co2_measured)::float AS "co2Measured",
        bool_or(mist_generator_active) AS "mistGeneratorActive",
        bool_or(convection_fan_active) AS "convectionFanActive",
        bool_or(heating_lamp_active) AS "heatingLampActive",
        bool_or(midday_blackout_active) AS "middayBlackoutActive"
      FROM telemetry_logs
      WHERE house_id = $2
        AND time >= $3
        AND time < $4
      GROUP BY bucket, house_id
      ORDER BY bucket ASC;
    `;

    const res = await this.db.query<{
      bucket: string | Date;
      houseId: string;
      temperatureMeasured: number | null;
      humidityMeasured: number | null;
      co2Measured: number | null;
      mistGeneratorActive: boolean | null;
      convectionFanActive: boolean | null;
      heatingLampActive: boolean | null;
      middayBlackoutActive: boolean | null;
    }>(queryText, [bucket, houseId, from, to]);

    return res.rows.map((row) => ({
      deviceId,
      houseId: row.houseId,
      time: new Date(row.bucket),
      batchId: null,
      cropDayInt: 0,
      temperatureMeasured:
        row.temperatureMeasured != null ? Number(row.temperatureMeasured) : null,
      humidityMeasured:
        row.humidityMeasured != null ? Number(row.humidityMeasured) : null,
      co2Measured: row.co2Measured != null ? Number(row.co2Measured) : null,
      humiditySetpoint: null,
      temperatureSetpoint: null,
      humidityErrorDelta: null,
      temperatureErrorDelta: null,
      mistGeneratorActive: Boolean(row.mistGeneratorActive),
      convectionFanActive: Boolean(row.convectionFanActive),
      heatingLampActive: Boolean(row.heatingLampActive),
      middayBlackoutActive: Boolean(row.middayBlackoutActive),
    }));
  }
}
