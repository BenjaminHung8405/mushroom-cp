import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from './database.service';

export interface TelemetryLogInput {
  time?: Date | string; // Defaults to now
  batchId: string;
  houseId: string;
  cropDayInt: number;

  humidityMeasured?: number;
  temperatureMeasured?: number;
  co2Measured?: number;

  humiditySetpoint?: number;
  temperatureSetpoint?: number;

  humidityErrorDelta?: number;
  temperatureErrorDelta?: number;

  mistGeneratorPwm?: number;
  convectionFanPwm?: number;
  heatingLampActive?: boolean;

  middayBlackoutActive?: boolean;
}

export interface TelemetryLog {
  time: Date;
  batch_id: string;
  house_id: string;
  crop_day_int: number;

  humidity_measured: number | null;
  temperature_measured: number | null;
  co2_measured: number | null;

  humidity_setpoint: number | null;
  temperature_setpoint: number | null;

  humidity_error_delta: number | null;
  temperature_error_delta: number | null;

  mist_generator_pwm: number | null;
  convection_fan_pwm: number | null;
  heating_lamp_active: boolean;

  midday_blackout_active: boolean;
}

export interface CurveCheckpoint {
  id: string;
  profile_id: string | null;
  batch_id: string | null;
  metric_type: 'TEMPERATURE' | 'HUMIDITY';
  crop_day: number;
  target_value: number;
}

@Injectable()
export class TelemetryQueryService {
  private readonly logger = new Logger(TelemetryQueryService.name);

  constructor(private readonly db: DatabaseService) {}

  private calculateDelta(setpoint?: number, measured?: number): number | null {
    if (setpoint === undefined || measured === undefined) return null;
    return parseFloat((setpoint - measured).toFixed(1));
  }

  /**
   * 1. Inserts sensor telemetry and actuator states into TimescaleDB hypertable
   */
  async insertTelemetry(input: TelemetryLogInput): Promise<TelemetryLog> {
    const time = input.time ? new Date(input.time) : new Date();

    const humidityErrorDelta =
      input.humidityErrorDelta !== undefined
        ? input.humidityErrorDelta
        : this.calculateDelta(input.humiditySetpoint, input.humidityMeasured);

    const temperatureErrorDelta =
      input.temperatureErrorDelta !== undefined
        ? input.temperatureErrorDelta
        : this.calculateDelta(
            input.temperatureSetpoint,
            input.temperatureMeasured,
          );

    const queryText = `
      INSERT INTO telemetry_logs (
        time, batch_id, house_id, crop_day_int,
        humidity_measured, temperature_measured, co2_measured,
        humidity_setpoint, temperature_setpoint,
        humidity_error_delta, temperature_error_delta,
        mist_generator_pwm, convection_fan_pwm, heating_lamp_active,
        midday_blackout_active
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9,
        $10, $11,
        $12, $13, $14,
        $15
      ) RETURNING *;
    `;

    const params = [
      time,
      input.batchId,
      input.houseId,
      input.cropDayInt,
      input.humidityMeasured ?? null,
      input.temperatureMeasured ?? null,
      input.co2Measured ?? null,
      input.humiditySetpoint ?? null,
      input.temperatureSetpoint ?? null,
      humidityErrorDelta,
      temperatureErrorDelta,
      input.mistGeneratorPwm ?? null,
      input.convectionFanPwm ?? null,
      input.heatingLampActive ?? false,
      input.middayBlackoutActive ?? false,
    ];

    const result = await this.db.query<TelemetryLog>(queryText, params);
    if (!result.rows || result.rows.length === 0) {
      throw new Error(
        'Failed to insert telemetry log: No records returned from DB',
      );
    }
    return result.rows[0];
  }

  /**
   * 2. Gets the latest telemetry record for a house (Uses idx_telemetry_latest for sub-50ms speed)
   */
  async getLatestTelemetryForHouse(
    houseId: string,
  ): Promise<TelemetryLog | null> {
    const queryText = `
      SELECT * FROM telemetry_logs
      WHERE house_id = $1
      ORDER BY time DESC
      LIMIT 1;
    `;
    const result = await this.db.query<TelemetryLog>(queryText, [houseId]);
    return result.rows[0] ?? null;
  }

  /**
   * 3. Retrieves telemetry history for a specific batch in a time range for plotting graphs
   */
  async getBatchHistory(
    batchId: string,
    startTime: Date | string,
    endTime: Date | string,
  ): Promise<TelemetryLog[]> {
    const queryText = `
      SELECT * FROM telemetry_logs
      WHERE batch_id = $1 AND time BETWEEN $2 AND $3
      ORDER BY time ASC;
    `;
    const result = await this.db.query<TelemetryLog>(queryText, [
      batchId,
      new Date(startTime),
      new Date(endTime),
    ]);
    return result.rows;
  }

  /**
   * 4. Retrieves checkpoints curve configuration for a batch
   */
  async getCurveCheckpointsForBatch(
    batchId: string,
    metricType?: 'TEMPERATURE' | 'HUMIDITY',
  ): Promise<CurveCheckpoint[]> {
    let queryText = `
      SELECT * FROM curve_checkpoints
      WHERE batch_id = $1
    `;
    const params: any[] = [batchId];

    if (metricType) {
      queryText += ` AND metric_type = $2`;
      params.push(metricType);
    }

    queryText += ` ORDER BY crop_day ASC;`;

    const result = await this.db.query<CurveCheckpoint>(queryText, params);
    return result.rows;
  }
}
