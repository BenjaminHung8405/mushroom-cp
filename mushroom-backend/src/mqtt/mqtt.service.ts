import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { Subject } from 'rxjs';
import * as mqtt from 'mqtt';
import { DeviceRegistryService } from '../device/device-registry.service';

export interface DeviceStatusEvent {
  deviceId: string;
  houseId: string;
  status: 'online' | 'offline';
  timestamp: string;
}

export interface TelemetryEvent {
  deviceId: string;
  houseId: string;
  temp_air: number | null;
  humidity_air: number | null;
  co2_level: number | null;
  receivedAt: Date;
  timestamp: string;
}

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: mqtt.MqttClient | null = null;

  public readonly deviceStatus$ = new Subject<DeviceStatusEvent>();
  public readonly telemetry$ = new Subject<TelemetryEvent>();
  private readonly deviceStateCache = new Map<string, DeviceStatusEvent>();
  private readonly unknownRefreshes = new Set<string>();

  constructor(
    @Inject(forwardRef(() => DeviceRegistryService))
    private readonly registry: DeviceRegistryService,
  ) {}

  onModuleInit(): void {
    this.connect();
  }

  onModuleDestroy(): void {
    this.client?.end(true);
    this.logger.log('MQTT client disconnected gracefully.');
  }

  private connect(): void {
    const host = process.env.MQTT_HOST ?? 'localhost';
    const port = parseInt(process.env.MQTT_PORT ?? '1883', 10);
    const username = process.env.MQTT_USERNAME ?? process.env.MQTT_BACKEND_USER;
    const password = process.env.MQTT_PASSWORD ?? process.env.MQTT_BACKEND_PASS;

    if (!username || !password) {
      this.logger.error(
        'MQTT_USERNAME and MQTT_PASSWORD must be set. Check your .env file and docker-compose.yml environment section.',
      );
      return;
    }

    const brokerUrl = `mqtt://${host}:${port}`;
    this.logger.log(`Connecting to EMQX at ${brokerUrl} as user '${username}'...`);

    this.client = mqtt.connect(brokerUrl, {
      username,
      password,
      clientId: `nestjs_backend_${Date.now()}`,
      keepalive: 60,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });

    this.client.on('connect', () => {
      this.logger.log('Connected to EMQX MQTT Broker.');
      this.subscribeToDeviceTopics();
    });
    this.client.on('message', (topic: string, payload: Buffer) => {
      this.handleIncomingMessage(topic, payload);
    });
    this.client.on('error', (error: Error) => {
      this.logger.error(`MQTT connection error: ${error.message}`);
    });
    this.client.on('reconnect', () => this.logger.warn('MQTT reconnecting...'));
    this.client.on('offline', () => this.logger.warn('MQTT client is offline.'));
  }

  private subscribeToDeviceTopics(): void {
    if (!this.client) return;
    this.client.subscribe('mushroom/device/+/status', { qos: 1 }, (err) => {
      if (err) this.logger.error(`Failed to subscribe to status topics: ${err.message}`);
      else this.logger.log("Subscribed to 'mushroom/device/+/status'");
    });
    this.client.subscribe('mushroom/device/+/telemetry', { qos: 1 }, (err) => {
      if (err) this.logger.error(`Failed to subscribe to telemetry topics: ${err.message}`);
      else this.logger.log("Subscribed to 'mushroom/device/+/telemetry'");
    });
  }

  private handleIncomingMessage(topic: string, payload: Buffer): void {
    const parsedTopic = this.parseDeviceTopic(topic);
    if (!parsedTopic) return;

    const record = this.registry.getEnabled(parsedTopic.deviceId);
    if (!record) {
      this.refreshUnknownDevice(parsedTopic.deviceId);
      this.logger.warn(`Dropped ${parsedTopic.action} from unknown or disabled device '${parsedTopic.deviceId}'.`);
      return;
    }

    if (Buffer.byteLength(payload) > 1024) {
      this.logger.warn(`Dropped oversized MQTT payload from '${record.deviceId}'.`);
      return;
    }

    try {
      const data = JSON.parse(payload.toString()) as unknown;
      if (!data || typeof data !== 'object') {
        this.logger.warn(`Dropped non-object payload from '${record.deviceId}'.`);
        return;
      }

      const receivedAt = new Date();
      if (parsedTopic.action === 'status') {
        const status = (data as { status?: unknown }).status;
        if (status !== 'online' && status !== 'offline') {
          this.logger.warn(`Received unknown status '${String(status)}' from ${record.deviceId}`);
          return;
        }
        const event: DeviceStatusEvent = {
          deviceId: record.deviceId,
          houseId: record.houseId,
          status,
          timestamp: receivedAt.toISOString(),
        };
        this.deviceStateCache.set(record.deviceId, event);
        this.deviceStatus$.next(event);
        void this.registry.touchLastSeen(record.deviceId, receivedAt);
        return;
      }

      const payloadObj = data as Record<string, unknown>;
      const tempAir = this.finiteMetric(payloadObj.temp_air);
      const humidityAir = this.finiteMetric(payloadObj.humidity_air);
      const co2Level = this.finiteMetric(payloadObj.co2_level);
      if (tempAir === null && humidityAir === null && co2Level === null) {
        this.logger.warn(`Dropped telemetry without canonical finite metrics from '${record.deviceId}'.`);
        return;
      }

      const event: TelemetryEvent = {
        deviceId: record.deviceId,
        houseId: record.houseId,
        temp_air: tempAir,
        humidity_air: humidityAir,
        co2_level: co2Level,
        receivedAt,
        timestamp: receivedAt.toISOString(),
      };
      this.telemetry$.next(event);
      void this.registry.touchLastSeen(record.deviceId, receivedAt);
    } catch (err) {
      this.logger.warn(`Failed to parse MQTT message on topic '${topic}': ${String(err)}`);
    }
  }

  private parseDeviceTopic(topic: string): { deviceId: string; action: 'status' | 'telemetry' } | null {
    const parts = topic.split('/');
    if (
      parts.length !== 4 ||
      parts[0] !== 'mushroom' ||
      parts[1] !== 'device' ||
      !/^[a-zA-Z0-9_-]{1,50}$/.test(parts[2]) ||
      (parts[3] !== 'status' && parts[3] !== 'telemetry')
    ) {
      return null;
    }
    return { deviceId: parts[2], action: parts[3] };
  }

  private finiteMetric(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private refreshUnknownDevice(deviceId: string): void {
    if (this.unknownRefreshes.has(deviceId)) return;
    this.unknownRefreshes.add(deviceId);
    void this.registry
      .refreshOne(deviceId)
      .catch((err: unknown) => {
        this.logger.warn(`Registry refresh failed for '${deviceId}': ${String(err)}`);
      })
      .finally(() => this.unknownRefreshes.delete(deviceId));
  }

  async dispatchSetpoint(
    deviceId: string,
    payload: {
      temperatureSetpoint: number;
      humiditySetpoint: number;
      co2Setpoint?: number;
      thermal_shock_protection?: boolean;
      thermal_shock_start?: string;
      thermal_shock_end?: string;
      control_mode: 'edge_hysteresis';
      setpoint_ttl_sec: number;
    },
  ): Promise<void> {
    if (!this.client?.connected) {
      throw new Error('MQTT client is not connected.');
    }
    await new Promise<void>((resolve, reject) => {
      this.client?.publish(
        `mushroom/device/${deviceId}/setpoint`,
        JSON.stringify(payload),
        { qos: 1 },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  getAllDeviceStatuses(): DeviceStatusEvent[] {
    return Array.from(this.deviceStateCache.values());
  }
}
