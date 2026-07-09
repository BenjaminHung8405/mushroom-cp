import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
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
   * In-memory store of the last known status for each device.
   * Used to return current state when a new SSE client connects.
   */
  private readonly deviceStateCache = new Map<string, DeviceStatusEvent>();

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.client?.end(true);
    this.logger.log('MQTT client disconnected gracefully.');
  }

  private async connect(): Promise<void> {
    const host = process.env.MQTT_HOST ?? 'localhost';
    const port = parseInt(process.env.MQTT_PORT ?? '1883', 10);
    const username = process.env.MQTT_USERNAME;
    const password = process.env.MQTT_PASSWORD;

    if (!username || !password) {
      this.logger.error(
        'MQTT_USERNAME and MQTT_PASSWORD must be set. ' +
        'Check your .env file and docker-compose.yml environment section.',
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
        this.logger.error(`Failed to subscribe to status topics: ${err.message}`);
      } else {
        this.logger.log("📡 Subscribed to 'mushroom/device/+/status'");
      }
    });
  }

  private handleIncomingMessage(topic: string, payload: Buffer): void {
    try {
      // Extract deviceId from topic: mushroom/device/{deviceId}/status
      const topicParts = topic.split('/');
      if (topicParts.length !== 4 || topicParts[0] !== 'mushroom' || topicParts[3] !== 'status') {
        return;
      }
      const deviceId = topicParts[2];

      const parsedPayload = JSON.parse(payload.toString()) as { status: 'online' | 'offline' };

      if (parsedPayload.status !== 'online' && parsedPayload.status !== 'offline') {
        this.logger.warn(`Received unknown status '${parsedPayload.status}' from ${deviceId}`);
        return;
      }

      const event: DeviceStatusEvent = {
        deviceId,
        status: parsedPayload.status,
        timestamp: new Date().toISOString(),
      };

      // Update cache and broadcast to all SSE subscribers
      this.deviceStateCache.set(deviceId, event);
      this.deviceStatus$.next(event);

      this.logger.log(`📨 Device '${deviceId}' → ${event.status.toUpperCase()}`);
    } catch (err) {
      this.logger.warn(`Failed to parse MQTT message on topic '${topic}': ${err}`);
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
   * Returns the current cached status for all known devices.
   * Used to seed the initial state for a newly connected SSE client.
   */
  getAllDeviceStatuses(): DeviceStatusEvent[] {
    return Array.from(this.deviceStateCache.values());
  }
}
