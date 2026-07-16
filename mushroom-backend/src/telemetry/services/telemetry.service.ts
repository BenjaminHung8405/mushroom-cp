import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  BadRequestException,
} from '@nestjs/common';
import { Subscription, Subject } from 'rxjs';
import { MqttService, ManualAckEvent, TelemetryEvent } from '../../mqtt/mqtt.service';
import { BatchService, BatchContext } from '../../batch/services/batch.service';
import { DatabaseService } from '../../database/database.service';
import { DeviceRegistryService } from '../../device/device-registry.service';

export interface ManualAckState {
  channel: 0 | 1 | 2;
  requested_intent: 'auto' | 'on' | 'off';
  decision: number;
  effective_intent: 'auto' | 'on' | 'off';
  release_reason: 'ttl_expired' | 'safety_limit_reached' | 'hardware_protection' | null;
  /** Server-wall-clock timestamp at which this latch expires; null for AUTO/release. */
  expires_ms: number | null;
  ack_ms: number;
}

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
  mistGeneratorActive: boolean | null;
  convectionFanActive: boolean | null;
  lampStageActive: boolean | null;
  lampStage2Active: boolean | null;
  heaterWaterActive: boolean | null;
  middayBlackoutActive: boolean | null;
  mistAck?: ManualAckState | null;
  fanAck?: ManualAckState | null;
  lampAck?: ManualAckState | null;
  operatingMode: 'AI' | 'MANUAL';
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
  mistGeneratorActive: boolean | null;
  convectionFanActive: boolean | null;
  lampStageActive: boolean | null;
  lampStage2Active: boolean | null;
  heaterWaterActive: boolean | null;
  middayBlackoutActive: boolean | null;
}

@Injectable()
export class TelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelemetryService.name);
  private telemetrySubscription: Subscription | null = null;
  private manualAckSubscription: Subscription | null = null;
  public readonly telemetryUpdates$ = new Subject<TelemetrySnapshot>();
  /** Keyed by deviceId (MQTT identity), never by houseId. */
  private readonly latestCache = new Map<string, TelemetrySnapshot>();
  /** Latest manual acks for each device. */
  private readonly manualAcks = new Map<string, { mistAck?: ManualAckState | null, fanAck?: ManualAckState | null, lampAck?: ManualAckState | null }>();

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
    this.manualAckSubscription = this.mqttService.manualAck$.subscribe(
      ({ deviceId, ack }) => {
        this.handleManualAck(deviceId, ack);
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
    if (this.manualAckSubscription) {
      this.manualAckSubscription.unsubscribe();
      this.logger.log('Unsubscribed from MQTT manual ack stream.');
    }
  }

  /**
   * Closed-loop observation + advisory setpoint dispatch.
   * Edge firmware remains safety authority for relays.
   */
  async processTelemetry(event: TelemetryEvent): Promise<void> {
    const timestamp = event.receivedAt ?? new Date(event.timestamp);
    const { deviceId, houseId } = event;
    if (!deviceId || !houseId) {
      this.logger.error(
        `Received telemetry without deviceId/houseId: ${JSON.stringify(event)}`,
      );
      return;
    }

    let context: BatchContext | null = null;
    try {
      context = await this.batchService.getBatchContext(houseId, timestamp);
      await this.saveTelemetryLog(houseId, event, context, timestamp);
      this.updateCache(deviceId, houseId, event, context, timestamp);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Critical error processing telemetry for device ${deviceId}: ${errMsg}`,
      );
    }

    // Deliberately do not publish setpoint commands here. Telemetry is an
    // observation channel; publishing on every sample would repeatedly reset
    // baseline state and make desired/applied configuration impossible to track.
    // Configuration is dispatched only by an explicit Apply/Sync flow, retry,
    // or device-reconnect policy.
  }

  async getLatestTelemetry(
    deviceId: string,
  ): Promise<TelemetrySnapshot | null> {
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
          lamp_stage_active AS "lampStageActive",
          lamp_stage2_active AS "lampStage2Active",
          heater_water_active AS "heaterWaterActive",
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

      const devAcks = this.manualAcks.get(deviceId) || {};
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
        mistGeneratorActive: row.mistGeneratorActive,
        convectionFanActive: row.convectionFanActive,
        lampStageActive: row.lampStageActive,
        lampStage2Active: row.lampStage2Active,
        heaterWaterActive: row.heaterWaterActive,
        middayBlackoutActive: row.middayBlackoutActive,
        mistAck: devAcks.mistAck ?? null,
        fanAck: devAcks.fanAck ?? null,
        lampAck: devAcks.lampAck ?? null,
        operatingMode: 'AI',
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
    timestamp: Date,
  ): Promise<void> {
    const humiditySetpoint = context.batchId ? context.targetHumid : null;
    const temperatureSetpoint = context.batchId ? context.targetTemp : null;
    const actuators = event.actuators;
    await this.db.query(
      `
      INSERT INTO telemetry_logs (
        time, batch_id, house_id, crop_day_int,
        humidity_measured, temperature_measured, co2_measured,
        humidity_setpoint, temperature_setpoint,
        humidity_error_delta, temperature_error_delta,
        mist_generator_active, convection_fan_active, lamp_stage_active,
        lamp_stage2_active, heater_water_active, midday_blackout_active
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      );`,
      [
        timestamp,
        context.batchId ?? 'idle',
        houseId,
        context.cropDay,
        event.humidity_air,
        event.temp_air,
        event.co2_level,
        humiditySetpoint,
        temperatureSetpoint,
        this.calculateDelta(humiditySetpoint, event.humidity_air),
        this.calculateDelta(temperatureSetpoint, event.temp_air),
        actuators?.mist_active ?? null,
        actuators?.fan_active ?? null,
        actuators?.lamp_stage_active ?? null,
        actuators?.lamp_stage2_active ?? null,
        actuators?.heater_water_active ?? null,
        actuators?.midday_blackout_active ?? null,
      ],
    );
  }

  private updateCache(
    deviceId: string,
    houseId: string,
    event: TelemetryEvent,
    context: BatchContext,
    timestamp: Date,
  ): void {
    const desiredHumiditySetpoint = context.batchId ? context.targetHumid : null;
    const desiredTemperatureSetpoint = context.batchId ? context.targetTemp : null;
    // On live telemetry, Core 1's final target is authoritative. Fall back to
    // the batch context only while an older firmware has not sent control data.
    const humiditySetpoint = event.control?.humidityTarget ?? desiredHumiditySetpoint;
    const temperatureSetpoint = event.control?.temperatureTarget ?? desiredTemperatureSetpoint;
    const actuators = event.actuators;
    const devAcks = this.manualAcks.get(deviceId) || {};
    const snapshot: TelemetrySnapshot = {
      deviceId,
      houseId,
      time: timestamp,
      batchId: context.batchId,
      cropDayInt: context.cropDay,
      humidityMeasured: event.humidity_air,
      temperatureMeasured: event.temp_air,
      co2Measured: event.co2_level,
      humiditySetpoint,
      temperatureSetpoint,
      humidityErrorDelta: this.calculateDelta(
        humiditySetpoint,
        event.humidity_air,
      ),
      temperatureErrorDelta: this.calculateDelta(
        temperatureSetpoint,
        event.temp_air,
      ),
      mistGeneratorActive: actuators?.mist_active ?? null,
      convectionFanActive: actuators?.fan_active ?? null,
      lampStageActive: actuators?.lamp_stage_active ?? null,
      lampStage2Active: actuators?.lamp_stage2_active ?? null,
      heaterWaterActive: actuators?.heater_water_active ?? null,
      middayBlackoutActive: actuators?.midday_blackout_active ?? null,
      mistAck: devAcks.mistAck ?? null,
      fanAck: devAcks.fanAck ?? null,
      lampAck: devAcks.lampAck ?? null,
      operatingMode: event.operatingMode ?? 'AI',
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
        bool_or(lamp_stage_active) AS "lampStageActive",
        bool_or(lamp_stage2_active) AS "lampStage2Active",
        bool_or(heater_water_active) AS "heaterWaterActive",
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
      lampStageActive: boolean | null;
      lampStage2Active: boolean | null;
      heaterWaterActive: boolean | null;
      middayBlackoutActive: boolean | null;
    }>(queryText, [bucket, houseId, from, to]);

    return res.rows.map((row) => ({
      deviceId,
      houseId: row.houseId,
      time: new Date(row.bucket),
      batchId: null,
      cropDayInt: 0,
      temperatureMeasured:
        row.temperatureMeasured != null
          ? Number(row.temperatureMeasured)
          : null,
      humidityMeasured:
        row.humidityMeasured != null ? Number(row.humidityMeasured) : null,
      co2Measured: row.co2Measured != null ? Number(row.co2Measured) : null,
      humiditySetpoint: null,
      temperatureSetpoint: null,
      humidityErrorDelta: null,
      temperatureErrorDelta: null,
      mistGeneratorActive: row.mistGeneratorActive,
      convectionFanActive: row.convectionFanActive,
      lampStageActive: row.lampStageActive,
      lampStage2Active: row.lampStage2Active,
      heaterWaterActive: row.heaterWaterActive,
      middayBlackoutActive: row.middayBlackoutActive,
      operatingMode: 'AI', // DB history does not store this; default to AI.
    }));
  }

  handleManualAck(deviceId: string, ack: ManualAckEvent): void {
    const intent = (value: 0 | 1 | 2): ManualAckState['effective_intent'] =>
      value === 1 ? 'on' : value === 2 ? 'off' : 'auto';
    const releaseReason = (value: 0 | 1 | 2 | 3): ManualAckState['release_reason'] =>
      value === 1 ? 'ttl_expired' :
      value === 2 ? 'safety_limit_reached' :
      value === 3 ? 'hardware_protection' : null;
    // Firmware millis() values are uptime-relative. Convert the remaining latch
    // duration at receipt into a browser-safe wall-clock expiry timestamp.
    const remainingMs = ack.expiresMs >= ack.ackMs ? ack.expiresMs - ack.ackMs : 0;
    const normalizedAck: ManualAckState = {
      channel: ack.channel,
      requested_intent: intent(ack.requestedIntent),
      decision: ack.decision,
      effective_intent: intent(ack.effectiveIntent),
      release_reason: releaseReason(ack.releaseReason),
      expires_ms: ack.effectiveIntent === 0 || remainingMs === 0
        ? null
        : ack.receivedAt.getTime() + remainingMs,
      ack_ms: ack.receivedAt.getTime(),
    };
    let devAcks = this.manualAcks.get(deviceId);
    if (!devAcks) {
      devAcks = {};
      this.manualAcks.set(deviceId, devAcks);
    }
    
    // In firmware AppChannel: MIST = 0, LAMP = 1, FAN = 2
    if (ack.channel === 0) {
      devAcks.mistAck = normalizedAck;
    } else if (ack.channel === 2) {
      devAcks.fanAck = normalizedAck;
    } else if (ack.channel === 1) {
      devAcks.lampAck = normalizedAck;
    }

    const existing = this.latestCache.get(deviceId);
    if (existing) {
      const updated = {
        ...existing,
        mistAck: devAcks.mistAck ?? null,
        fanAck: devAcks.fanAck ?? null,
        lampAck: devAcks.lampAck ?? null,
      };
      this.latestCache.set(deviceId, updated);
      this.telemetryUpdates$.next(updated);
    }
  }
}
