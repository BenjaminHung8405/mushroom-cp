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

export interface EdgeActuatorState {
  mist_active: boolean;
  fan_active: boolean;
  lamp_stage_active: boolean;
  lamp_stage2_active: boolean;
  heater_water_active: boolean;
  midday_blackout_active: boolean;
}

export interface TelemetryEvent {
  deviceId: string;
  houseId: string;
  temp_air: number | null;
  humidity_air: number | null;
  co2_level: number | null;
  actuators: EdgeActuatorState | null;
  receivedAt: Date;
  timestamp: string;
}

export interface CommandAckEvent {
  deviceId: string;
  commandId: string;
  status: 'SUCCESS' | 'FAILED' | 'EXPIRED';
  latencyMs: number | null;
  relayId: string | null;
  actualState: 'ON' | 'OFF' | null;
  error: { code: string; message: string } | null;
  receivedAt: Date;
}

type UplinkFeature =
  | 'status'
  | 'telemetry'
  | 'provisioning_announce'
  | 'command_ack';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private readonly tenant = process.env.IOT_TENANT ?? 'mushroom';
  private client: mqtt.MqttClient | null = null;

  public readonly deviceStatus$ = new Subject<DeviceStatusEvent>();
  public readonly telemetry$ = new Subject<TelemetryEvent>();
  /** Kept temporarily for API compatibility; V3 remote manual ACKs were removed. */
  public readonly manualAck$ = new Subject<{ deviceId: string; ack: any }>();
  public readonly commandAck$ = new Subject<CommandAckEvent>();
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
      this.logger.error('MQTT_USERNAME and MQTT_PASSWORD must be configured.');
      return;
    }

    const brokerUrl = `mqtt://${host}:${port}`;
    this.logger.log(`Connecting to Mosquitto at ${brokerUrl} as '${username}'.`);
    this.client = mqtt.connect(brokerUrl, {
      username,
      password,
      clientId: 'mushroom_backend',
      keepalive: 60,
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });
    this.client.on('connect', () => {
      this.logger.log('Connected to Mosquitto MQTT broker.');
      this.subscribeToDeviceTopics();
    });
    this.client.on('message', (topic: string, payload: Buffer) =>
      this.handleIncomingMessage(topic, payload),
    );
    this.client.on('error', (error: Error) =>
      this.logger.error(`MQTT connection error: ${error.message}`),
    );
    this.client.on('reconnect', () => this.logger.warn('MQTT reconnecting...'));
  }

  private subscribeToDeviceTopics(): void {
    if (!this.client) return;
    const subscriptions = [
      `${this.tenant}/esp32/+/status`,
      `${this.tenant}/esp32/+/up/telemetry`,
      `${this.tenant}/esp32/+/up/provisioning/announce`,
      `${this.tenant}/esp32/+/up/command/ack`,
    ];
    for (const topic of subscriptions) {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err) this.logger.error(`Failed subscribing '${topic}': ${err.message}`);
        else this.logger.log(`Subscribed '${topic}'.`);
      });
    }
  }

  private handleIncomingMessage(topic: string, payload: Buffer): void {
    const parsedTopic = this.parseUplinkTopic(topic);
    if (!parsedTopic) return;
    if (Buffer.byteLength(payload) > 2048) {
      this.logger.warn(`Dropped oversized MQTT payload from '${parsedTopic.deviceId}'.`);
      return;
    }

    const record = this.registry.getEnabled(parsedTopic.deviceId);
    if (!record) {
      this.refreshUnknownDevice(parsedTopic.deviceId);
      this.logger.warn(`Dropped ${parsedTopic.feature} from unknown/disabled '${parsedTopic.deviceId}'.`);
      return;
    }

    try {
      const data = JSON.parse(payload.toString()) as Record<string, unknown>;
      if (!data || Array.isArray(data)) throw new Error('payload must be an object');
      const receivedAt = new Date();
      if (parsedTopic.feature === 'status') {
        this.handleStatus(record.deviceId, record.houseId, data, receivedAt);
      } else if (parsedTopic.feature === 'telemetry') {
        this.handleTelemetry(record.deviceId, record.houseId, data, receivedAt);
      } else if (parsedTopic.feature === 'provisioning_announce') {
        this.handleProvisioning(record.deviceId, data, receivedAt);
      } else {
        this.handleCommandAck(record.deviceId, data, receivedAt);
      }
    } catch (error) {
      this.logger.warn(`Failed parsing '${topic}': ${String(error)}`);
    }
  }

  private handleStatus(
    deviceId: string,
    houseId: string,
    data: Record<string, unknown>,
    receivedAt: Date,
  ): void {
    const online = data.online;
    if (typeof online !== 'boolean') {
      this.logger.warn(`Dropped status without boolean online from '${deviceId}'.`);
      return;
    }
    const event: DeviceStatusEvent = {
      deviceId,
      houseId,
      status: online ? 'online' : 'offline',
      timestamp: receivedAt.toISOString(),
    };
    this.deviceStateCache.set(deviceId, event);
    this.deviceStatus$.next(event);
    void this.registry.touchLastSeen(deviceId, receivedAt);
  }

  private handleTelemetry(
    deviceId: string,
    houseId: string,
    data: Record<string, unknown>,
    receivedAt: Date,
  ): void {
    const readings = this.object(data.readings);
    const event: TelemetryEvent = {
      deviceId,
      houseId,
      temp_air: this.finiteMetric(readings?.temperature_celsius),
      humidity_air: this.finiteMetric(readings?.humidity_percent),
      co2_level: null,
      actuators: this.parseActuators(data.actuator_states),
      receivedAt,
      timestamp: receivedAt.toISOString(),
    };
    if (event.temp_air === null && event.humidity_air === null) {
      this.logger.warn(`Dropped telemetry without finite SHT readings from '${deviceId}'.`);
      return;
    }
    this.telemetry$.next(event);
    void this.registry.touchLastSeen(deviceId, receivedAt);
  }

  private handleProvisioning(
    deviceId: string,
    data: Record<string, unknown>,
    receivedAt: Date,
  ): void {
    if (data.device_id !== deviceId) {
      this.logger.warn(`Dropped provisioning announce with mismatched device_id for '${deviceId}'.`);
      return;
    }
    // Registry is the authority; ACK is retained so first boot receives config.
    void this.registry.touchLastSeen(deviceId, receivedAt);
    void this.publishProvisioningAck(deviceId);
  }

  private handleCommandAck(
    deviceId: string,
    data: Record<string, unknown>,
    receivedAt: Date,
  ): void {
    const commandId = typeof data.command_id === 'string' ? data.command_id : '';
    const status = data.status;
    if (!commandId || !['SUCCESS', 'FAILED', 'EXPIRED'].includes(String(status))) {
      this.logger.warn(`Dropped malformed command ACK from '${deviceId}'.`);
      return;
    }
    const result = this.object(data.result);
    const error = this.object(data.error);
    this.commandAck$.next({
      deviceId,
      commandId,
      status: status as CommandAckEvent['status'],
      latencyMs: this.finiteMetric(data.latency_ms),
      relayId: typeof result?.relay_id === 'string' ? result.relay_id : null,
      actualState:
        result?.actual_state === 'ON' || result?.actual_state === 'OFF'
          ? result.actual_state
          : null,
      error:
        typeof error?.code === 'string' && typeof error?.message === 'string'
          ? { code: error.code, message: error.message }
          : null,
      receivedAt,
    });
    void this.registry.touchLastSeen(deviceId, receivedAt);
  }

  private parseUplinkTopic(
    topic: string,
  ): { deviceId: string; feature: UplinkFeature } | null {
    const parts = topic.split('/');
    const validId = (value: string) => /^[a-zA-Z0-9_-]{1,50}$/.test(value);
    if (parts.length === 4 && parts[0] === this.tenant && parts[1] === 'esp32' && validId(parts[2]) && parts[3] === 'status') {
      return { deviceId: parts[2], feature: 'status' };
    }
    if (parts.length !== 5 || parts[0] !== this.tenant || parts[1] !== 'esp32' || !validId(parts[2]) || parts[3] !== 'up') return null;
    if (parts[4] === 'telemetry') return { deviceId: parts[2], feature: 'telemetry' };
    if (parts[4] === 'provisioning/announce') return null;
    // provisioning/announce and command/ack have one additional path segment.
    return null;
  }

  private object(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private parseActuators(value: unknown): EdgeActuatorState | null {
    const states = this.object(value);
    if (!states) return null;
    const on = (id: string) => states[id] === 'ON';
    const known = (id: string) => states[id] === 'ON' || states[id] === 'OFF';
    if (!['relay_1', 'relay_2', 'relay_3', 'relay_4'].every(known)) return null;
    return {
      mist_active: on('relay_1'),
      fan_active: on('relay_2'),
      heater_water_active: on('relay_3'),
      lamp_stage_active: on('relay_4'),
      lamp_stage2_active: false,
      midday_blackout_active: false,
    };
  }

  private async publishProvisioningAck(deviceId: string): Promise<void> {
    await this.publish(`${this.tenant}/esp32/${deviceId}/down/provisioning/ack`, {
      $schema: 'https://iot.acme.com/schema/v1/provision-ack',
      status: 'ACCEPTED',
      device_id: deviceId,
      assigned_config: { telemetry_interval_sec: 30, command_timeout_sec: 10, reporting_qos: 1 },
      server_timestamp_utc: new Date().toISOString(),
    }, true);
  }

  async dispatchRelayCommand(
    deviceId: string,
    relayId: 'relay_1' | 'relay_2' | 'relay_3' | 'relay_4',
    state: 'ON' | 'OFF',
    issuedBy = 'system',
  ): Promise<string> {
    const commandId = crypto.randomUUID();
    await this.publish(`${this.tenant}/esp32/${deviceId}/down/command`, {
      $schema: 'https://iot.acme.com/schema/v1/command',
      command_id: commandId,
      device_id: deviceId,
      issued_by: issuedBy,
      timestamp_utc: new Date().toISOString(),
      expires_at_utc: new Date(Date.now() + 10_000).toISOString(),
      action: 'SET_RELAY',
      parameters: { relay_id: relayId, state, duration_sec: 0 },
    });
    return commandId;
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
      control_mode: 'fuzzy_tpc';
      setpoint_ttl_sec: number;
    },
  ): Promise<void> {
    this.logger.debug(
      `dispatchSetpoint: Advisory setpoint for ${deviceId} is a no-op in MQTT-only mode. Payload: ${JSON.stringify(
        payload,
      )}`,
    );
  }

  async dispatchActuatorOverride(
    deviceId: string,
    actuator: 'fan' | 'heater_air' | 'mist' | 'lamp' | 'lamp_stage',
    state: boolean | null,
  ): Promise<void> {
    this.logger.log(
      `dispatchActuatorOverride: translating ${actuator} override (state=${state}) to SET_RELAY command for ${deviceId}`,
    );

    let relayId: 'relay_1' | 'relay_2' | 'relay_3' | 'relay_4';
    switch (actuator) {
      case 'mist':
        relayId = 'relay_1';
        break;
      case 'fan':
        relayId = 'relay_2';
        break;
      case 'heater_air':
        relayId = 'relay_3';
        break;
      case 'lamp':
      case 'lamp_stage':
        relayId = 'relay_4';
        break;
      default:
        this.logger.error(`Unknown actuator type: ${actuator}`);
        return;
    }

    const commandState: 'ON' | 'OFF' = state === true ? 'ON' : 'OFF';
    await this.dispatchRelayCommand(deviceId, relayId, commandState, 'user-override');
  }

  private async publish(topic: string, payload: unknown, retain = false): Promise<void> {
    if (!this.client?.connected) throw new Error('MQTT client is not connected.');
    await new Promise<void>((resolve, reject) => {
      this.client?.publish(topic, JSON.stringify(payload), { qos: 1, retain }, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  getAllDeviceStatuses(): DeviceStatusEvent[] {
    return Array.from(this.deviceStateCache.values());
  }

  private finiteMetric(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private refreshUnknownDevice(deviceId: string): void {
    if (this.unknownRefreshes.has(deviceId)) return;
    this.unknownRefreshes.add(deviceId);
    void this.registry
      .refreshOne(deviceId)
      .catch((error: unknown) => this.logger.warn(`Registry refresh failed for '${deviceId}': ${String(error)}`))
      .finally(() => this.unknownRefreshes.delete(deviceId));
  }
}
