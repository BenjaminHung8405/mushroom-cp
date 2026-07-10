import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Subscription, Subject } from 'rxjs';
import { toZonedTime } from 'date-fns-tz';
import { MqttService, TelemetryEvent } from '../../mqtt/mqtt.service';
import { BatchService, BatchContext } from '../../batch/services/batch.service';
import { DatabaseService } from '../../database/database.service';

export interface TelemetrySnapshot {
  time: Date;
  batchId: string | null;
  houseId: string;
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

  // Subject for SSE/REST stream updates
  readonly telemetryUpdates$ = new Subject<TelemetrySnapshot>();

  // In-memory cache for sub-ms real-time queries (REST/SSE)
  private readonly latestCache = new Map<string, TelemetrySnapshot>();

  constructor(
    private readonly mqttService: MqttService,
    private readonly batchService: BatchService,
    private readonly db: DatabaseService,
  ) {}

  onModuleInit(): void {
    this.telemetrySubscription = this.mqttService.telemetry$.subscribe(
      (event) => {
        this.processTelemetry(event).catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          const errStack = err instanceof Error ? err.stack : undefined;
          this.logger.error(
            `Unhandled error in telemetry stream subscriber: ${errMsg}`,
            errStack,
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
   * Main telemetry processing routine.
   * Closed-loop control cycle wrapped in a strict try/catch/finally block.
   */
  async processTelemetry(event: TelemetryEvent): Promise<void> {
    const timestamp = new Date();
    const houseId = event.deviceId;

    if (!houseId) {
      this.logger.error(
        `Received telemetry event without deviceId: ${JSON.stringify(event)}`,
      );
      return;
    }

    // Default control actions
    let controlActions = {
      mist_generator_active: false,
      convection_fan_active: false,
      heating_lamp_active: false,
      midday_blackout_active: false,
    };

    try {
      // 1. Get current crop batch context
      const context = await this.batchService.getBatchContext(
        houseId,
        timestamp,
      );

      // 2. Idle Guard: If batchId is null (house is empty), turn off all actuators
      if (context.batchId === null) {
        controlActions = {
          mist_generator_active: false,
          convection_fan_active: false,
          heating_lamp_active: false,
          midday_blackout_active: false,
        };

        // Save log and update cache for empty house (idle state)
        await this.saveTelemetryLog(event, context, controlActions, timestamp);
        this.updateCache(houseId, event, context, controlActions, timestamp);
      } else {
        // 3. Normal operation: Compute closed-loop outputs
        const outputs = this.calculateControlOutputs(event, context, timestamp);
        controlActions = {
          mist_generator_active: outputs.mistGeneratorActive,
          convection_fan_active: outputs.convectionFanActive,
          heating_lamp_active: outputs.heatingLampActive,
          midday_blackout_active: outputs.middayBlackoutActive,
        };

        // 4. Save to TimescaleDB
        await this.saveTelemetryLog(event, context, controlActions, timestamp);

        // 5. Update real-time snapshot cache
        this.updateCache(houseId, event, context, controlActions, timestamp);
      }
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Critical error processing telemetry for house ${houseId}: ${errMsg}`,
        errStack,
      );

      // Emergency fallback (mist OFF, fan ON, lamp OFF)
      controlActions = {
        mist_generator_active: false,
        convection_fan_active: true,
        heating_lamp_active: false,
        midday_blackout_active: false,
      };
    } finally {
      // 6. Always dispatch setpoint payload to MQTT topic.
      // Must be wrapped in a nested try/catch to avoid eating errors from the try block.
      try {
        this.mqttService.dispatchSetpoint(houseId, controlActions);
      } catch (dispatchError: unknown) {
        const dispatchErrMsg =
          dispatchError instanceof Error
            ? dispatchError.message
            : String(dispatchError);
        const dispatchErrStack =
          dispatchError instanceof Error ? dispatchError.stack : undefined;
        this.logger.error(
          `Failed to dispatch setpoint payload to MQTT broker for house ${houseId}: ${dispatchErrMsg}`,
          dispatchErrStack,
        );
      }
    }
  }

  /**
   * Helper to retrieve the latest cached snapshot for a house.
   */
  getLatestTelemetry(houseId: string): TelemetrySnapshot | null {
    return this.latestCache.get(houseId) ?? null;
  }

  /**
   * Calculates control outputs based on biological parameters, midday blackout, and sensor readings.
   */
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

    // Convert current time to Asia/Ho_Chi_Minh for timezone-independent midday blackout calculations
    const zonedTime = toZonedTime(timestamp, 'Asia/Ho_Chi_Minh');
    const minutesSinceMidnight =
      zonedTime.getHours() * 60 + zonedTime.getMinutes();

    // Check Midday Blackout constraints
    let isBlackoutActive = false;
    if (context.thermalShockProtection) {
      const startMin = context.thermalShockStart
        ? this.parseTimeToMinutes(context.thermalShockStart)
        : 660; // 11:00
      const endMin = context.thermalShockEnd
        ? this.parseTimeToMinutes(context.thermalShockEnd)
        : 810; // 13:30
      if (minutesSinceMidnight >= startMin && minutesSinceMidnight <= endMin) {
        isBlackoutActive = true;
      }
    }

    // Mist Generator ON/OFF
    let mistGeneratorActive = false;
    if (
      !isBlackoutActive &&
      humidityAir !== null &&
      humidityAir !== undefined
    ) {
      mistGeneratorActive = humidityAir < context.targetHumid;
    }

    // Convection Fan ON/OFF
    let convectionFanActive = false;
    if (
      tempAir !== null &&
      tempAir !== undefined &&
      tempAir > context.targetTemp
    ) {
      convectionFanActive = true;
    }
    if (co2Level !== null && co2Level !== undefined && co2Level > 1000) {
      convectionFanActive = true;
    }

    // Heating Lamp ON/OFF
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

  /**
   * Helper to parse "HH:MM:SS" or "HH:MM" string to minutes since midnight.
   */
  private parseTimeToMinutes(timeStr: string): number {
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
  }

  /**
   * Calculates delta setpoint - measured, rounded to 1 decimal place.
   */
  private calculateDelta(
    setpoint: number | null,
    measured: number | null,
  ): number | null {
    if (setpoint === null || measured === null) return null;
    return parseFloat((setpoint - measured).toFixed(1));
  }

  /**
   * Inserts telemetry and control states into TimescaleDB using Raw SQL.
   */
  private async saveTelemetryLog(
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

    const humidityErrorDelta = this.calculateDelta(
      humiditySetpoint,
      humidityMeasured,
    );
    const temperatureErrorDelta = this.calculateDelta(
      temperatureSetpoint,
      temperatureMeasured,
    );

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
      context.batchId ?? 'idle', // batch_id is NOT NULL in database schema, so fallback to 'idle'
      event.deviceId,
      context.cropDay,
      humidityMeasured,
      temperatureMeasured,
      co2Measured,
      humiditySetpoint,
      temperatureSetpoint,
      humidityErrorDelta,
      temperatureErrorDelta,
      controlActions.mist_generator_active,
      controlActions.convection_fan_active,
      controlActions.heating_lamp_active,
      controlActions.midday_blackout_active,
    ];

    await this.db.query(queryText, params);
  }

  /**
   * Updates the in-memory cache snapshot.
   */
  private updateCache(
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

    const humidityErrorDelta = this.calculateDelta(
      humiditySetpoint,
      humidityMeasured,
    );
    const temperatureErrorDelta = this.calculateDelta(
      temperatureSetpoint,
      temperatureMeasured,
    );

    const snapshot: TelemetrySnapshot = {
      time: timestamp,
      batchId: context.batchId,
      houseId,
      cropDayInt: context.cropDay,
      humidityMeasured,
      temperatureMeasured,
      co2Measured,
      humiditySetpoint,
      temperatureSetpoint,
      humidityErrorDelta,
      temperatureErrorDelta,
      mistGeneratorActive: controlActions.mist_generator_active,
      convectionFanActive: controlActions.convection_fan_active,
      heatingLampActive: controlActions.heating_lamp_active,
      middayBlackoutActive: controlActions.midday_blackout_active,
    };

    this.latestCache.set(houseId, snapshot);
    this.telemetryUpdates$.next(snapshot);
  }

  /**
   * Queries telemetry history from TimescaleDB between two dates using Raw SQL.
   */
  async getTelemetryHistory(
    houseId: string,
    from: Date,
    to: Date,
  ): Promise<TelemetrySnapshot[]> {
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
      WHERE house_id = $1 AND time BETWEEN $2 AND $3
      ORDER BY time ASC;
    `;
    const res = await this.db.query<TelemetryLogDbRow>(queryText, [
      houseId,
      from,
      to,
    ]);
    return res.rows.map((row) => ({
      time: new Date(row.time),
      batchId: row.batchId === 'idle' ? null : row.batchId,
      houseId: row.houseId,
      cropDayInt: Number(row.cropDayInt),
      humidityMeasured:
        row.humidityMeasured != null
          ? parseFloat(String(row.humidityMeasured))
          : null,
      temperatureMeasured:
        row.temperatureMeasured != null
          ? parseFloat(String(row.temperatureMeasured))
          : null,
      co2Measured: row.co2Measured != null ? Number(row.co2Measured) : null,
      humiditySetpoint:
        row.humiditySetpoint != null
          ? parseFloat(String(row.humiditySetpoint))
          : null,
      temperatureSetpoint:
        row.temperatureSetpoint != null
          ? parseFloat(String(row.temperatureSetpoint))
          : null,
      humidityErrorDelta:
        row.humidityErrorDelta != null
          ? parseFloat(String(row.humidityErrorDelta))
          : null,
      temperatureErrorDelta:
        row.temperatureErrorDelta != null
          ? parseFloat(String(row.temperatureErrorDelta))
          : null,
      mistGeneratorActive: Boolean(row.mistGeneratorActive),
      convectionFanActive: Boolean(row.convectionFanActive),
      heatingLampActive: Boolean(row.heatingLampActive),
      middayBlackoutActive: Boolean(row.middayBlackoutActive),
    }));
  }
}
