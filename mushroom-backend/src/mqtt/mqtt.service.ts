import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Subject } from 'rxjs';
import * as mqtt from 'mqtt';

/**
 * Represents the parsed status payload from the MQTT status topic.
 * Published by:
 *   - ESP32-S3 on connect:    { status: 'online' }
 *   - EMQX LWT on disconnect: { status: 'offline' }
 */
export interface DeviceStatusEvent {
  deviceId: string;
  status: 'online' | 'offline';
  timestamp: string;
}

export interface TelemetryEvent {
  deviceId: string;
  temp_air: number | null; // Air temperature from SHT30
  humidity_air: number | null; // Air humidity from SHT30
  co2_level: number | null; // CO2 from SCD30
  timestamp: string; // ISO string
}

/**
 * MqttService — Core infrastructure service for MQTT connectivity.
 *
 * Responsibilities:
 *   1. Connects to the EMQX broker using credentials from env (nestjs_backend account).
 *   2. Subscribes to mushroom/device/+/status to receive LWT and online broadcasts.
 *   3. Exposes an Observable stream (deviceStatus$) for other services/controllers to consume.
 *   4. Provides a publish() method for sending setpoint commands to devices.
 *
 * Security:
 *   - Uses a dedicated MQTT account (nestjs_backend) with restricted permissions.
 *   - All credentials come from environment variables — never hardcoded.
 *
 * LWT Flow:
 *   ESP32 connects → publishes {"status":"online"} (retained) → goes offline →
 *   EMQX fires LWT → publishes {"status":"offline"} → this service emits event →
 *   SSE controller pushes update to Next.js UI (UI turns Crimson).
 */
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: mqtt.MqttClient | null = null;

  /**
   * Observable stream of device status events.
   * Controllers subscribe to this to push updates via SSE.
   */
  public readonly deviceStatus$ = new Subject<DeviceStatusEvent>();

  /**
   * Observable stream of telemetry events.
   */
  public readonly telemetry$ = new Subject<TelemetryEvent>();

  /**
   * In-memory store of the last known status for each device.
   * Used to return current state when a new SSE client connects.
   */
  private readonly deviceStateCache = new Map<string, DeviceStatusEvent>();

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
        'MQTT_USERNAME and MQTT_PASSWORD must be set. ' +
          'Check your .env file and docker-compose.yml environment section.',
      );
      return;
    }

    const brokerUrl = `mqtt://${host}:${port}`;
    this.logger.log(
      `Connecting to EMQX at ${brokerUrl} as user '${username}'...`,
    );

    this.client = mqtt.connect(brokerUrl, {
      username,
      password,
      clientId: `nestjs_backend_${Date.now()}`,
      keepalive: 60,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });

    this.client.on('connect', () => {
      this.logger.log('✅ Connected to EMQX MQTT Broker.');
      this.subscribeToStatusTopics();
    });

    this.client.on('message', (topic: string, payload: Buffer) => {
      this.handleIncomingMessage(topic, payload);
    });

    this.client.on('error', (error: Error) => {
      this.logger.error(`MQTT connection error: ${error.message}`);
    });

    this.client.on('reconnect', () => {
      this.logger.warn('MQTT reconnecting...');
    });

    this.client.on('offline', () => {
      this.logger.warn('MQTT client is offline.');
    });
  }

  private subscribeToStatusTopics(): void {
    if (!this.client) return;

    // Subscribe to all device status topics (LWT + online broadcasts)
    // '+' is a single-level wildcard — matches any single segment
    // Example: mushroom/device/esp32_mushroom_s3_01/status
    this.client.subscribe('mushroom/device/+/status', { qos: 1 }, (err) => {
      if (err) {
        this.logger.error(
          `Failed to subscribe to status topics: ${err.message}`,
        );
      } else {
        this.logger.log("📡 Subscribed to 'mushroom/device/+/status'");
      }
    });

    // Subscribe to all device telemetry topics
    this.client.subscribe('mushroom/device/+/telemetry', { qos: 1 }, (err) => {
      if (err) {
        this.logger.error(
          `Failed to subscribe to telemetry topics: ${err.message}`,
        );
      } else {
        this.logger.log("📡 Subscribed to 'mushroom/device/+/telemetry'");
      }
    });
  }

  private handleIncomingMessage(topic: string, payload: Buffer): void {
    try {
      const topicParts = topic.split('/');
      if (topicParts.length !== 4 || topicParts[0] !== 'mushroom') {
        return;
      }
      const deviceId = topicParts[2];
      const action = topicParts[3];

      if (action === 'status') {
        const parsedPayload = JSON.parse(payload.toString()) as unknown;
        if (
          !parsedPayload ||
          typeof parsedPayload !== 'object' ||
          !('status' in parsedPayload)
        ) {
          this.logger.warn(`Received invalid JSON payload from ${deviceId}`);
          return;
        }

        const status = parsedPayload.status;
        if (status !== 'online' && status !== 'offline') {
          this.logger.warn(
            `Received unknown status '${status as string}' from ${deviceId}`,
          );
          return;
        }

        const event: DeviceStatusEvent = {
          deviceId,
          status,
          timestamp: new Date().toISOString(),
        };

        // Update cache and broadcast to all SSE subscribers
        this.deviceStateCache.set(deviceId, event);
        this.deviceStatus$.next(event);

        this.logger.log(
          `📨 Device '${deviceId}' → ${event.status.toUpperCase()}`,
        );
      } else if (action === 'telemetry') {
        const parsedPayload = JSON.parse(payload.toString()) as Record<
          string,
          unknown
        >;

        const event: TelemetryEvent = {
          deviceId,
          temp_air:
            typeof parsedPayload.temp_air === 'number'
              ? parsedPayload.temp_air
              : null,
          humidity_air:
            typeof parsedPayload.humidity_air === 'number'
              ? parsedPayload.humidity_air
              : null,
          co2_level:
            typeof parsedPayload.co2_level === 'number'
              ? parsedPayload.co2_level
              : null,
          timestamp: new Date().toISOString(),
        };

        this.telemetry$.next(event);
        this.logger.debug(
          `📨 Telemetry from '${deviceId}': ${JSON.stringify(event)}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Failed to parse MQTT message on topic '${topic}': ${err}`,
      );
    }
  }

  /**
   * Publish a control command (setpoint) to a specific device.
   * Topic: mushroom/device/{deviceId}/setpoint
   *
   * @param deviceId - The target device's MQTT username
   * @param payload  - Command payload (will be JSON.stringified)
   */
  publish(deviceId: string, payload: Record<string, unknown>): void {
    if (!this.client?.connected) {
      this.logger.error('Cannot publish: MQTT client is not connected.');
      return;
    }

    const topic = `mushroom/device/${deviceId}/setpoint`;
    const message = JSON.stringify(payload);

    this.client.publish(topic, message, { qos: 1 }, (err) => {
      if (err) {
        this.logger.error(`Failed to publish to '${topic}': ${err.message}`);
      } else {
        this.logger.log(`📤 Published to '${topic}': ${message}`);
      }
    });
  }

  /**
   * Publish a setpoint to a specific device using preset schema.
   */
  dispatchSetpoint(
    houseId: string,
    payload: {
      mist_generator_active: boolean;
      convection_fan_active: boolean;
      heating_lamp_active: boolean;
      midday_blackout_active: boolean;
    },
  ): void {
    const topic = `mushroom/device/${houseId}/setpoint`;
    const message = JSON.stringify(payload);
    if (!this.client?.connected) {
      this.logger.error(
        `Cannot publish setpoint: MQTT client is not connected.`,
      );
      return;
    }
    this.client.publish(topic, message, { qos: 1 }, (err) => {
      if (err) {
        this.logger.error(
          `Failed to publish setpoint to '${topic}': ${err.message}`,
        );
      } else {
        this.logger.log(`📤 Published setpoint to '${topic}': ${message}`);
      }
    });
  }

  /**
   * Returns the current cached status for all known devices.
   * Used to seed the initial state for a newly connected SSE client.
   */
  getAllDeviceStatuses(): DeviceStatusEvent[] {
    return Array.from(this.deviceStateCache.values());
  }
}
