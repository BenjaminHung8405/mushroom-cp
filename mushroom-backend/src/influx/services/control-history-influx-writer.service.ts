import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Point, WriteApi } from '@influxdata/influxdb-client';
import { InfluxDbService } from './influx-db.service';
import { ConfigService } from './config.service';
import { MqttService, TelemetryEvent } from '../../mqtt/mqtt.service';
import { LiveTelemetryPoint } from '../interfaces/live-telemetry-point.interface';

type RawTelemetryPayload = TelemetryEvent;

@Injectable()
export class ControlHistoryInfluxWriter implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ControlHistoryInfluxWriter.name);
  private readonly destroy$ = new Subject<void>();
  private writeApi: WriteApi | null = null;
  private readonly bucket: string;

  constructor(
    private readonly influxDbService: InfluxDbService,
    private readonly mqttService: MqttService,
    private readonly configService: ConfigService,
  ) {
    this.bucket = this.configService.get('INFLUXDB_BUCKET') ?? '';
  }

  onModuleInit(): void {
    if (!this.bucket) {
      this.logger.error('INFLUXDB_BUCKET is not configured. ControlHistoryInfluxWriter will not record data.');
      return;
    }

    try {
      this.writeApi = this.influxDbService.getWriteApi(this.bucket, 'ms');
    } catch (err: any) {
      this.logger.error(`Failed to initialize InfluxDB WriteApi: ${err.message}`);
    }

    this.mqttService.telemetry$
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (event) => {
          try {
            const point = this.mapTelemetryToPoint(event);
            this.writePoint(point).catch((err) => {
              this.handleWriteError(err, point);
            });
          } catch (err: any) {
            // Catch synchronous mapping error or promise rejection inside subscription
            this.logger.error(`Error processing telemetry for device ${event.deviceId}: ${err.message}`);
          }
        },
        error: (err) => {
          this.logger.error(`Error in telemetry$ stream: ${err.message}`);
        },
      });
  }

  async onModuleDestroy(): Promise<void> {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.writeApi) {
      try {
        await this.writeApi.close();
      } catch (err: any) {
        this.logger.error(`Error closing InfluxDB WriteApi: ${err.message}`);
      }
    }
  }

  private mapTelemetryToPoint(raw: RawTelemetryPayload): LiveTelemetryPoint {
    const timestamp = raw.receivedAt ? new Date(raw.receivedAt) : new Date(raw.timestamp);

    let dataQuality: 'good' | 'degraded' | 'missing_target' = 'good';
    if (
      raw.temp_air === null ||
      raw.humidity_air === null ||
      !raw.actuators ||
      raw.actuators.mist_active === null ||
      raw.actuators.lamp_stage_active === null ||
      raw.actuators.fan_active === null
    ) {
      dataQuality = 'degraded';
    } else if (
      !raw.control ||
      raw.control.temperatureTarget === null ||
      raw.control.humidityTarget === null
    ) {
      dataQuality = 'missing_target';
    }

    return {
      deviceId: raw.deviceId,
      timestamp,
      dataQuality,
      temperatureC: raw.temp_air ?? 0,
      humidityPercent: raw.humidity_air ?? 0,
      tempTarget: raw.control?.temperatureTarget ?? null,
      humidTarget: raw.control?.humidityTarget ?? null,
      controlSource: raw.control?.source ?? null,
      configRevision: raw.control?.configRevision ?? null,
      mistState: raw.actuators?.mist_active ?? false,
      lampState: raw.actuators?.lamp_stage_active ?? false,
      fanState: raw.actuators?.fan_active ?? false,
    };
  }

  private async writePoint(point: LiveTelemetryPoint): Promise<void> {
    if (!this.writeApi) {
      throw new Error('InfluxDB WriteApi is not initialized');
    }

    const influxPoint = new Point('controller_history')
      .tag('device_id', point.deviceId)
      .tag('data_quality', point.dataQuality);

    if (point.controlSource !== null) {
      influxPoint.tag('control_source', point.controlSource);
    }

    // Set fields
    influxPoint.timestamp(point.timestamp);
    influxPoint.floatField('temperature_c', point.temperatureC);
    influxPoint.floatField('humidity_percent', point.humidityPercent);

    if (point.tempTarget !== null) {
      influxPoint.floatField('temp_target', point.tempTarget);
    }
    if (point.humidTarget !== null) {
      influxPoint.floatField('humid_target', point.humidTarget);
    }
    if (point.configRevision !== null) {
      influxPoint.intField('config_revision', point.configRevision);
    }

    influxPoint.booleanField('mist_state', point.mistState);
    influxPoint.booleanField('lamp_state', point.lampState);
    influxPoint.booleanField('fan_state', point.fanState);

    this.writeApi.writePoint(influxPoint);
    await this.writeApi.flush();
  }

  private handleWriteError(error: Error, point: LiveTelemetryPoint): void {
    this.logger.error(
      `Failed to write controller history point for device ${point.deviceId}: ${error.message}`,
    );
  }
}
