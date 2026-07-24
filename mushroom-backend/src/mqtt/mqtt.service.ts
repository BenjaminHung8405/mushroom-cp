import {
  Inject,
  Injectable,
  Logger,
  Optional,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { Subject, Subscription } from 'rxjs';
import * as mqtt from 'mqtt';
import { DeviceRegistryService } from '../device/device-registry.service';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { Device } from '../device/entities/device.entity';
import { MqttAuthService } from '../mqtt-auth/mqtt-auth.service';
import {
  DeviceHealthService,
  HealthState,
} from '../device-health/device-health.service';
import { decodeOfflineSyncBurst, type OfflineSyncBurst } from './offline-sync';
import {
  getTuningDesiredTopic,
  getTuningReportedPattern,
  parseTuningTopic,
} from './constants/mqtt-topics.const';
import {
  LAMP_GAIN_SCALE_MAX,
  LAMP_GAIN_SCALE_MIN,
  MIN_THRESHOLD_GAP,
  MIST_GAIN_SCALE_MAX,
  MIST_GAIN_SCALE_MIN,
  MIST_OFF_THRESHOLD_MAX,
  MIST_OFF_THRESHOLD_MIN,
  MIST_ON_THRESHOLD_MAX,
  MIST_ON_THRESHOLD_MIN,
} from '../tuning/constants/tuning-contract.constants';
import type { TuningConfigSnapshot } from '../tuning/entities/device-tuning-configuration.entity';

export interface DeviceStatusEvent {
  deviceId: string;
  houseId: string;
  status: 'online' | 'offline';
  health: HealthState;
  lastTelemetryAt: string | null;
  receivedAt: string;
  timestamp: string;
}

export interface EdgeActuatorState {
  mist_active: boolean | null;
  fan_active: boolean | null;
  lamp_stage_active: boolean | null;
  lamp_stage2_active: boolean | null;
  heater_water_active: boolean | null;
  /** Null means legacy/malformed firmware telemetry did not confirm the interlock. */
  midday_blackout_active: boolean | null;
}

export interface TelemetryEvent {
  deviceId: string;
  houseId: string;
  temp_air: number | null;
  humidity_air: number | null;
  co2_level: number | null;
  /** Final setpoints calculated by Core 1, if supported by the firmware. */
  control?: {
    temperatureTarget: number | null;
    humidityTarget: number | null;
    co2Target: number | null;
    source: string | null;
    configRevision: number | null;
  } | null;
  actuators: EdgeActuatorState | null;
  operatingMode?: 'AI' | 'MANUAL';
  receivedAt: Date;
  timestamp: string;
}

export interface ManualAckEvent {
  channel: 0 | 1 | 2;
  requestedIntent: 0 | 1 | 2;
  decision: number;
  effectiveIntent: 0 | 1 | 2;
  releaseReason: 0 | 1 | 2 | 3;
  expiresMs: number;
  ackMs: number;
  receivedAt: Date;
}

export interface SetOperatingModeDto {
  mode: 'AI' | 'MANUAL';
}

export type DeviceConfigSyncStatus =
  'PENDING' | 'ACKED' | 'APPLIED' | 'FAILED' | 'TIMEOUT';

export interface DeviceConfigSyncEvent {
  deviceId: string;
  commandId: string;
  kind: 'baseline_setpoint' | 'crop_profile';
  desiredRevision: number;
  appliedRevision: number | null;
  status: DeviceConfigSyncStatus;
  error: { code: string; message: string } | null;
  updatedAt: string;
}

interface PendingConfigCommand extends DeviceConfigSyncEvent {
  timeout: NodeJS.Timeout;
}

export interface CropProfileCommand {
  configRevision?: number;
  cropStartEpochSec: number;
  totalCropDays: number;
  checkpoints: Array<{
    cropDay: number;
    temperatureCelsius: number;
    humidityPercent: number;
  }>;
  lightSchedule?: Array<{
    startDay: number;
    endDay: number;
    status: 'ON' | 'OFF';
  }>;
}

export interface CommandAckEvent {
  deviceId: string;
  commandId: string;
  status: 'SUCCESS' | 'FAILED' | 'EXPIRED';
  latencyMs: number | null;
  /** Generic ACK result fields; relay fields remain available for SET_RELAY. */
  resultKind: string | null;
  configRevision: number | null;
  relayId: string | null;
  actualState: 'ON' | 'OFF' | null;
  error: { code: string; message: string } | null;
  receivedAt: Date;
}

export interface TuningReportedEvent {
  deviceId: string;
  commandId: string;
  status: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED';
  reasonCode: string | null;
  persisted: boolean;
  /** Canonical v1 effective configuration asserted by the Edge. */
  reportedConfig: TuningConfigSnapshot;
  /** Exact persisted effective revision asserted by the Edge. */
  revision: number;
  receivedAt: Date;
}

import { AppConfigService } from '../config/config.service';

type UplinkFeature =
  | 'status'
  | 'telemetry'
  | 'provisioning_announce'
  | 'command_ack'
  | 'manual_ack'
  | 'sync_burst'
  | 'tuning_reported';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private readonly tenant: string;
  private client: mqtt.MqttClient | null = null;

  public readonly deviceStatus$ = new Subject<DeviceStatusEvent>();
  public readonly telemetry$ = new Subject<TelemetryEvent>();
  /** Core 1 manual-control acknowledgements, forwarded to telemetry SSE. */
  public readonly manualAck$ = new Subject<{
    deviceId: string;
    ack: ManualAckEvent;
  }>();
  public readonly commandAck$ = new Subject<CommandAckEvent>();
  /** Strictly validated tuning ACKs. Device identity always comes from the topic. */
  public readonly tuningReported$ = new Subject<TuningReportedEvent>();
  /** Validated binary offline chunks; consumers persist them before ACKing. */
  public readonly offlineSyncBurst$ = new Subject<{
    deviceId: string;
    houseId: string;
    receivedAt: Date;
    burst: OfflineSyncBurst;
  }>();
  private readonly deviceStateCache = new Map<string, DeviceStatusEvent>();
  private readonly unknownRefreshes = new Set<string>();
  private readonly pendingConfig = new Map<string, PendingConfigCommand>();
  private readonly configSyncCache = new Map<string, DeviceConfigSyncEvent>();
  public readonly configSync$ = new Subject<DeviceConfigSyncEvent>();
  private healthSubscription: Subscription | null = null;

  constructor(
    @Inject(forwardRef(() => DeviceRegistryService))
    private readonly registry: DeviceRegistryService,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    private readonly mqttAuth: MqttAuthService,
    private readonly configService: AppConfigService,
    @Optional() private readonly deviceHealth?: DeviceHealthService,
  ) {
    this.tenant = this.configService.getTenant();
  }

  onModuleInit(): void {
    this.healthSubscription =
      this.deviceHealth?.healthChanges$.subscribe((event) => {
        this.deviceStateCache.set(event.deviceId, event);
        this.deviceStatus$.next(event);
      }) ?? null;
    this.connect();
  }

  onModuleDestroy(): void {
    this.healthSubscription?.unsubscribe();
    this.healthSubscription = null;
    for (const pending of this.pendingConfig.values())
      clearTimeout(pending.timeout);
    this.pendingConfig.clear();
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
    this.logger.log(
      `Connecting to Mosquitto at ${brokerUrl} as '${username}'.`,
    );
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
      `${this.tenant}/esp32/+/up/sync-burst`,
      getTuningReportedPattern(this.tenant),
      `${this.tenant}/provision/request`,
    ];
    for (const topic of subscriptions) {
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (err)
          this.logger.error(`Failed subscribing '${topic}': ${err.message}`);
        else this.logger.log(`Subscribed '${topic}'.`);
      });
    }
  }

  private handleIncomingMessage(topic: string, payload: Buffer): void {
    if (topic === `${this.tenant}/provision/request`) {
      void this.handleBootstrapProvisionRequest(payload);
      return;
    }

    const parsedTopic = this.parseUplinkTopic(topic);
    if (!parsedTopic) return;
    if (Buffer.byteLength(payload) > 2048) {
      this.logger.warn(
        `Dropped oversized MQTT payload from '${parsedTopic.deviceId}'.`,
      );
      return;
    }

    const record = this.registry.getEnabled(parsedTopic.deviceId);
    if (!record) {
      this.refreshUnknownDevice(parsedTopic.deviceId);
      this.logger.warn(
        `Dropped ${parsedTopic.feature} from unknown/disabled '${parsedTopic.deviceId}'.`,
      );
      return;
    }

    try {
      const receivedAt = new Date();
      if (parsedTopic.feature === 'sync_burst') {
        const burst = decodeOfflineSyncBurst(payload);
        this.offlineSyncBurst$.next({
          deviceId: record.deviceId,
          houseId: record.houseId,
          receivedAt,
          burst,
        });
        return;
      }
      const data = JSON.parse(payload.toString()) as Record<string, unknown>;
      if (!data || Array.isArray(data))
        throw new Error('payload must be an object');
      if (parsedTopic.feature === 'status') {
        this.handleStatus(record, data, receivedAt);
      } else if (parsedTopic.feature === 'telemetry') {
        this.handleTelemetry(record, data, receivedAt);
      } else if (parsedTopic.feature === 'provisioning_announce') {
        this.handleProvisioning(record.deviceId, data, receivedAt);
      } else if (parsedTopic.feature === 'manual_ack') {
        this.handleManualAck(record.deviceId, data, receivedAt);
      } else if (parsedTopic.feature === 'tuning_reported') {
        this.handleTuningReported(record.deviceId, data, receivedAt);
      } else {
        this.handleCommandAck(record.deviceId, data, receivedAt);
      }
    } catch (error) {
      this.logger.warn(`Failed parsing '${topic}': ${String(error)}`);
    }
  }

  private async handleBootstrapProvisionRequest(
    payload: Buffer,
  ): Promise<void> {
    if (Buffer.byteLength(payload) > 1024) {
      this.logger.warn('Dropped oversized MQTT provisioning request.');
      return;
    }

    try {
      const data = JSON.parse(payload.toString()) as Record<string, unknown>;
      const macAddress =
        typeof data.mac_address === 'string'
          ? data.mac_address.toLowerCase()
          : '';
      if (!/^[a-f0-9]{12}$/.test(macAddress)) {
        this.logger.warn(
          'Dropped provisioning request with invalid MAC address.',
        );
        return;
      }
      this.mqttAuth.enforceProvisionRateLimit(macAddress);

      const deviceId = `mushroom_s3_${macAddress}`;
      let device = await this.deviceRepo.findOne({ where: { deviceId } });
      if (!device) {
        const houseId = process.env.DEFAULT_DEVICE_HOUSE_ID;
        if (!houseId) {
          this.logger.error(
            `Cannot provision '${deviceId}': DEFAULT_DEVICE_HOUSE_ID is not configured.`,
          );
          return;
        }
        device = this.deviceRepo.create({
          deviceId,
          houseId,
          enabled: true,
          mqttUsername: deviceId,
          token: randomUUID(),
          displayName: null,
          lastSeenAt: null,
        });
        device = await this.deviceRepo.save(device);
        this.registry.upsertCache({
          deviceId: device.deviceId,
          houseId: device.houseId,
          enabled: device.enabled,
          displayName: device.displayName,
          mqttUsername: device.mqttUsername,
          lastSeenAt: device.lastSeenAt,
        });
        this.logger.log(`Provisioned '${deviceId}' for house '${houseId}'.`);
      } else if (!device.enabled || !device.token) {
        device.enabled = true;
        device.token = randomUUID();
        device = await this.deviceRepo.save(device);
        this.registry.upsertCache({
          deviceId: device.deviceId,
          houseId: device.houseId,
          enabled: device.enabled,
          displayName: device.displayName,
          mqttUsername: device.mqttUsername,
          lastSeenAt: device.lastSeenAt,
        });
      }

      await this.publish(
        `${this.tenant}/provision/response/${macAddress}`,
        {
          device_id: device.deviceId,
          mqtt_username: device.mqttUsername,
          mqtt_token: device.token,
          telemetry_interval_sec: 30,
          reporting_qos: 1,
        },
        true,
      );
    } catch (error) {
      this.logger.warn(
        `Failed handling MQTT provisioning request: ${String(error)}`,
      );
    }
  }

  private handleStatus(
    record: import('../device/device-registry.service').DeviceRecord,
    data: Record<string, unknown>,
    receivedAt: Date,
  ): void {
    const { deviceId, houseId } = record;
    const online = data.online;
    if (typeof online !== 'boolean') {
      this.logger.warn(
        `Dropped status without boolean online from '${deviceId}'.`,
      );
      return;
    }
    const healthEvent = this.deviceHealth?.handleLwtStatus(
      record,
      online ? 'online' : 'offline',
      receivedAt,
    );
    const event: DeviceStatusEvent = healthEvent ?? {
      deviceId,
      houseId,
      status: online ? 'online' : 'offline',
      health: online ? HealthState.ONLINE_ACTIVE : HealthState.OFFLINE,
      lastTelemetryAt: null,
      receivedAt: receivedAt.toISOString(),
      timestamp: receivedAt.toISOString(),
    };
    this.deviceStateCache.set(deviceId, event);
    this.deviceStatus$.next(event);
    void this.registry.touchLastSeen(deviceId, receivedAt);
  }

  private handleTelemetry(
    record: import('../device/device-registry.service').DeviceRecord,
    data: Record<string, unknown>,
    receivedAt: Date,
  ): void {
    const { deviceId, houseId } = record;
    const readings = this.object(data.readings);
    const control = this.object(data.control);
    const event: TelemetryEvent = {
      deviceId,
      houseId,
      temp_air: this.finiteMetric(readings?.temperature_celsius),
      humidity_air: this.finiteMetric(readings?.humidity_percent),
      co2_level: null,
      control: control
        ? {
            temperatureTarget: this.finiteMetric(
              control.temperature_target_celsius,
            ),
            humidityTarget: this.finiteMetric(control.humidity_target_percent),
            co2Target: this.finiteMetric(control.co2_target_ppm),
            source: typeof control.source === 'string' ? control.source : null,
            configRevision: this.nonNegativeInteger(control.config_revision),
          }
        : null,
      actuators: this.parseActuators(data.actuator_states),
      operatingMode: data.operating_mode === 'MANUAL' ? 'MANUAL' : 'AI',
      receivedAt,
      timestamp: receivedAt.toISOString(),
    };
    if (event.temp_air === null && event.humidity_air === null) {
      const describe = (value: unknown) =>
        value === undefined
          ? 'missing'
          : value === null
            ? 'null'
            : Array.isArray(value)
              ? 'array'
              : typeof value;
      this.logger.warn(
        `Dropped telemetry without finite SHT readings from '${deviceId}' ` +
          `(temperature_celsius=${describe(readings?.temperature_celsius)}, humidity_percent=${describe(readings?.humidity_percent)}).`,
      );
      return;
    }
    this.telemetry$.next(event);
    const healthEvent = this.deviceHealth?.handleTelemetryReceived(
      record,
      receivedAt,
    );
    if (healthEvent) this.deviceStateCache.set(deviceId, healthEvent);
    this.confirmAppliedFromTelemetry(
      deviceId,
      event.control?.configRevision ?? null,
    );
    void this.registry.touchLastSeen(deviceId, receivedAt);
  }

  private handleProvisioning(
    deviceId: string,
    data: Record<string, unknown>,
    receivedAt: Date,
  ): void {
    if (data.device_id !== deviceId) {
      this.logger.warn(
        `Dropped provisioning announce with mismatched device_id for '${deviceId}'.`,
      );
      return;
    }
    // Registry is the authority; ACK is retained so first boot receives config.
    void this.registry.touchLastSeen(deviceId, receivedAt);
    void this.publishProvisioningAck(deviceId);
  }

  private handleManualAck(
    deviceId: string,
    data: Record<string, unknown>,
    receivedAt: Date,
  ): void {
    const integer = (value: unknown): number | null =>
      typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
    const channel = integer(data.channel);
    const requestedIntent = integer(data.requested_intent);
    const decision = integer(data.decision);
    const effectiveIntent = integer(data.effective_intent);
    const releaseReason = integer(data.release_reason);
    const expiresMs = integer(data.expires_ms);
    const ackMs = integer(data.ack_ms);

    if (
      channel === null ||
      channel < 0 ||
      channel > 2 ||
      requestedIntent === null ||
      requestedIntent < 0 ||
      requestedIntent > 2 ||
      decision === null ||
      decision < 0 ||
      effectiveIntent === null ||
      effectiveIntent < 0 ||
      effectiveIntent > 2 ||
      releaseReason === null ||
      releaseReason < 0 ||
      releaseReason > 3 ||
      expiresMs === null ||
      expiresMs < 0 ||
      ackMs === null ||
      ackMs < 0
    ) {
      this.logger.warn(`Dropped malformed manual ACK from '${deviceId}'.`);
      return;
    }

    this.manualAck$.next({
      deviceId,
      ack: {
        channel: channel as ManualAckEvent['channel'],
        requestedIntent: requestedIntent as ManualAckEvent['requestedIntent'],
        decision,
        effectiveIntent: effectiveIntent as ManualAckEvent['effectiveIntent'],
        releaseReason: releaseReason as ManualAckEvent['releaseReason'],
        expiresMs,
        ackMs,
        receivedAt,
      },
    });
    void this.registry.touchLastSeen(deviceId, receivedAt);
  }

  private handleCommandAck(
    deviceId: string,
    data: Record<string, unknown>,
    receivedAt: Date,
  ): void {
    const commandId =
      typeof data.command_id === 'string' ? data.command_id : '';
    const status = data.status;
    if (
      !commandId ||
      !['SUCCESS', 'FAILED', 'EXPIRED'].includes(String(status))
    ) {
      this.logger.warn(`Dropped malformed command ACK from '${deviceId}'.`);
      return;
    }
    const result = this.object(data.result);
    const error = this.object(data.error);
    const ack: CommandAckEvent = {
      deviceId,
      commandId,
      status: status as CommandAckEvent['status'],
      latencyMs: this.finiteMetric(data.latency_ms),
      resultKind: typeof result?.kind === 'string' ? result.kind : null,
      configRevision: this.nonNegativeInteger(result?.config_revision),
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
    };
    this.commandAck$.next(ack);
    this.applyConfigAck(ack);
    void this.registry.touchLastSeen(deviceId, receivedAt);
  }

  private handleTuningReported(
    deviceId: string,
    data: Record<string, unknown>,
    receivedAt: Date,
  ): void {
    const commandId =
      typeof data.command_id === 'string' ? data.command_id : '';
    const status = data.status;
    const persisted = data.persisted;
    if (
      !commandId ||
      !['ACCEPTED', 'DUPLICATE', 'REJECTED'].includes(String(status)) ||
      typeof persisted !== 'boolean'
    ) {
      this.logger.warn(`Dropped malformed tuning ACK from '${deviceId}'.`);
      return;
    }
    if (data.device_id !== deviceId) {
      this.logger.warn(
        `Dropped tuning ACK with mismatched device_id for '${deviceId}'.`,
      );
      return;
    }
    const reasonCode =
      typeof data.reason_code === 'string' ? data.reason_code : null;
    if ((status === 'REJECTED') !== (reasonCode !== null)) {
      this.logger.warn(
        `Dropped tuning ACK with invalid reason_code for '${deviceId}'.`,
      );
      return;
    }
    const reportedConfig = this.parseTuningSnapshot(data.reported_config);
    const revision = this.nonNegativeInteger(data.revision);
    if (!reportedConfig || revision === null) {
      this.logger.warn(
        `Dropped tuning ACK with invalid reported_config/revision from '${deviceId}'.`,
      );
      return;
    }
    this.tuningReported$.next({
      deviceId,
      commandId,
      status: status as TuningReportedEvent['status'],
      reasonCode,
      persisted,
      reportedConfig,
      revision,
      receivedAt,
    });
    void this.registry.touchLastSeen(deviceId, receivedAt);
  }

  private parseUplinkTopic(
    topic: string,
  ): { deviceId: string; feature: UplinkFeature } | null {
    const tuningTopic = parseTuningTopic(topic);
    if (
      tuningTopic?.tenant === this.tenant &&
      tuningTopic.kind === 'reported'
    ) {
      return { deviceId: tuningTopic.deviceId, feature: 'tuning_reported' };
    }
    const parts = topic.split('/');
    const validId = (value: string) => /^[a-zA-Z0-9_-]{1,50}$/.test(value);
    if (
      parts.length === 4 &&
      parts[0] === this.tenant &&
      parts[1] === 'esp32' &&
      validId(parts[2]) &&
      parts[3] === 'status'
    ) {
      return { deviceId: parts[2], feature: 'status' };
    }
    if (
      parts[0] !== this.tenant ||
      parts[1] !== 'esp32' ||
      !validId(parts[2]) ||
      parts[3] !== 'up'
    )
      return null;
    if (parts.length === 5 && parts[4] === 'telemetry')
      return { deviceId: parts[2], feature: 'telemetry' };
    if (parts.length === 5 && parts[4] === 'sync-burst')
      return { deviceId: parts[2], feature: 'sync_burst' };
    if (
      parts.length === 6 &&
      parts[4] === 'provisioning' &&
      parts[5] === 'announce'
    ) {
      return { deviceId: parts[2], feature: 'provisioning_announce' };
    }
    if (parts.length === 6 && parts[4] === 'command' && parts[5] === 'ack') {
      return { deviceId: parts[2], feature: 'command_ack' };
    }
    if (parts.length === 6 && parts[4] === 'manual' && parts[5] === 'ack') {
      return { deviceId: parts[2], feature: 'manual_ack' };
    }
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
      midday_blackout_active:
        typeof states.midday_blackout_active === 'boolean'
          ? states.midday_blackout_active
          : null,
    };
  }

  private async publishProvisioningAck(deviceId: string): Promise<void> {
    await this.publish(
      `${this.tenant}/esp32/${deviceId}/down/provisioning/ack`,
      {
        $schema: 'https://iot.acme.com/schema/v1/provision-ack',
        status: 'ACCEPTED',
        device_id: deviceId,
        assigned_config: {
          telemetry_interval_sec: 30,
          command_timeout_sec: 10,
          reporting_qos: 1,
        },
        server_timestamp_utc: new Date().toISOString(),
      },
      true,
    );
  }

  async acknowledgeOfflineSyncBurst(
    deviceId: string,
    burst: Pick<OfflineSyncBurst, 'bootCount' | 'chunkIndex' | 'chunkCrc32'>,
  ): Promise<void> {
    await this.publish(`${this.tenant}/esp32/${deviceId}/down/sync-burst/ack`, {
      boot_count: burst.bootCount,
      chunk_index: burst.chunkIndex,
      chunk_crc32: burst.chunkCrc32,
    });
  }

  async dispatchRelayCommand(
    deviceId: string,
    relayId: 'relay_1' | 'relay_2' | 'relay_3' | 'relay_4',
    state: 'ON' | 'OFF',
    issuedBy = 'system',
  ): Promise<string> {
    this.assertCommandAllowed(deviceId);
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
  async publishTuningDesired(
    deviceId: string,
    commandId: string,
    revision: number,
    config: {
      lamp_gain_scale: number;
      mist_gain_scale: number;
      mist_on_threshold: number;
      mist_off_threshold: number;
    },
  ): Promise<void> {
    const topic = getTuningDesiredTopic(this.tenant, deviceId);
    await this.publish(
      topic,
      {
        schema_version: 1,
        command_id: commandId,
        device_id: deviceId,
        revision,
        config: {
          lamp_gain_scale: config.lamp_gain_scale,
          mist_gain_scale: config.mist_gain_scale,
          mist_on_threshold: config.mist_on_threshold,
          mist_off_threshold: config.mist_off_threshold,
        },
      },
      true, // retain = true
    );
  }

  async clearTuningDesired(deviceId: string): Promise<void> {
    const topic = getTuningDesiredTopic(this.tenant, deviceId);
    if (!this.client?.connected) {
      throw new Error('MQTT client is not connected.');
    }
    await new Promise<void>((resolve, reject) => {
      this.client?.publish(
        topic,
        '',
        { qos: 1, retain: true },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }


  async dispatchSetpoint(
    deviceId: string,
    payload: {
      temperatureSetpoint: number;
      humiditySetpoint: number;
      co2Setpoint?: number;
      setpoint_ttl_sec: number;
      configRevision?: number;
    },
  ): Promise<DeviceConfigSyncEvent> {
    this.assertCommandAllowed(deviceId);
    const revision = payload.configRevision ?? this.nextRevision(deviceId);
    this.validateSetpoint(
      payload.temperatureSetpoint,
      payload.humiditySetpoint,
      payload.co2Setpoint ?? 1000,
    );
    return this.dispatchConfigCommand(deviceId, 'baseline_setpoint', revision, {
      $schema: 'https://iot.acme.com/schema/v1/command',
      command_id: randomUUID(),
      device_id: deviceId,
      issued_by: 'ui-setpoint-sync',
      timestamp_utc: new Date().toISOString(),
      expires_at_utc: new Date(Date.now() + 15_000).toISOString(),
      action: 'SET_BASELINE_SETPOINT',
      parameters: {
        config_revision: revision,
        temperature_celsius: payload.temperatureSetpoint,
        humidity_percent: payload.humiditySetpoint,
        co2_ppm: payload.co2Setpoint ?? 1000,
        clear_existing_override: false,
        ttl_sec: 0,
      },
    });
  }

  async dispatchCropProfile(
    deviceId: string,
    profile: CropProfileCommand,
  ): Promise<DeviceConfigSyncEvent> {
    this.assertCommandAllowed(deviceId);
    const revision = profile.configRevision ?? this.nextRevision(deviceId);
    if (
      !Number.isInteger(profile.totalCropDays) ||
      profile.totalCropDays < 1 ||
      profile.totalCropDays > 365 ||
      profile.checkpoints.length < 1 ||
      profile.checkpoints.length > 10
    ) {
      throw new Error(
        'Crop profile must contain 1–10 checkpoints and a valid totalCropDays.',
      );
    }
    let previousDay = 0;
    for (const point of profile.checkpoints) {
      this.validateSetpoint(
        point.temperatureCelsius,
        point.humidityPercent,
        1000,
      );
      if (
        !Number.isInteger(point.cropDay) ||
        point.cropDay <= previousDay ||
        point.cropDay > profile.totalCropDays
      ) {
        throw new Error(
          'Crop profile checkpoint days must be strictly increasing and within totalCropDays.',
        );
      }
      previousDay = point.cropDay;
    }
    if (profile.lightSchedule) {
      if (
        profile.lightSchedule.length < 1 ||
        profile.lightSchedule.length > 7
      ) {
        throw new Error('Light schedule must contain 1–7 blocks.');
      }
      let expectedStart = 1;
      let previousStatus: 'ON' | 'OFF' | null = null;
      for (const block of profile.lightSchedule) {
        if (
          !Number.isInteger(block.startDay) ||
          !Number.isInteger(block.endDay) ||
          block.startDay !== expectedStart ||
          block.startDay > block.endDay ||
          block.endDay > profile.totalCropDays ||
          block.status === previousStatus
        ) {
          throw new Error(
            'Light schedule blocks must be contiguous, in range, and alternate status.',
          );
        }
        expectedStart = block.endDay + 1;
        previousStatus = block.status;
      }
      if (expectedStart !== profile.totalCropDays + 1) {
        throw new Error('Light schedule must cover all crop days.');
      }
    }
    return this.dispatchConfigCommand(deviceId, 'crop_profile', revision, {
      $schema: 'https://iot.acme.com/schema/v1/command',
      command_id: randomUUID(),
      device_id: deviceId,
      issued_by: 'ui-profile-sync',
      timestamp_utc: new Date().toISOString(),
      expires_at_utc: new Date(Date.now() + 15_000).toISOString(),
      action: 'SET_CROP_PROFILE',
      parameters: {
        config_revision: revision,
        clear_baseline: true,
        profile: {
          schema_version: 1,
          crop_start_epoch_s: profile.cropStartEpochSec,
          total_crop_days: profile.totalCropDays,
          checkpoints: profile.checkpoints.map((point) => ({
            crop_day: point.cropDay,
            temp_target_c: point.temperatureCelsius,
            humidity_target_rh: point.humidityPercent,
          })),
          ...(profile.lightSchedule
            ? {
                light_schedule: profile.lightSchedule.map((block) => ({
                  start_day: block.startDay,
                  end_day: block.endDay,
                  status: block.status,
                })),
              }
            : {}),
        },
      },
    });
  }

  async dispatchSetOperatingMode(
    deviceId: string,
    mode: 'AI' | 'MANUAL',
  ): Promise<void> {
    this.assertCommandAllowed(deviceId);
    this.logger.log(
      `dispatchSetOperatingMode: switching ${deviceId} to ${mode}`,
    );
    await this.publish(`${this.tenant}/esp32/${deviceId}/down/command`, {
      $schema: 'https://iot.acme.com/schema/v1/command',
      command_id: crypto.randomUUID(),
      device_id: deviceId,
      issued_by: 'ui-operating-mode',
      timestamp_utc: new Date().toISOString(),
      // Intentionally no expires_at_utc: mode changes must work before NTP
      // makes the Edge clock trusted.
      action: 'SET_OPERATING_MODE',
      parameters: { mode },
    });
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
    await this.dispatchRelayCommand(
      deviceId,
      relayId,
      commandState,
      'user-override',
    );
  }

  private assertCommandAllowed(deviceId: string): void {
    if (this.deviceHealth && !this.deviceHealth.isCommandAllowed(deviceId)) {
      throw new Error(
        `Device '${deviceId}' is not healthy enough to accept commands.`,
      );
    }
  }

  getConfigSync(deviceId: string): DeviceConfigSyncEvent | null {
    return this.configSyncCache.get(deviceId) ?? null;
  }

  private nextRevision(deviceId: string): number {
    const current = this.configSyncCache.get(deviceId)?.desiredRevision ?? 0;
    return Math.max(current + 1, Math.floor(Date.now() / 1000));
  }

  private validateSetpoint(
    temperature: number,
    humidity: number,
    co2: number,
  ): void {
    if (
      !Number.isFinite(temperature) ||
      temperature < 15 ||
      temperature > 45 ||
      !Number.isFinite(humidity) ||
      humidity < 50 ||
      humidity > 100 ||
      !Number.isFinite(co2) ||
      co2 < 400 ||
      co2 > 10_000
    ) {
      throw new Error('Setpoint is outside the device safety range.');
    }
  }

  private async dispatchConfigCommand(
    deviceId: string,
    kind: 'baseline_setpoint' | 'crop_profile',
    revision: number,
    command: Record<string, unknown>,
  ): Promise<DeviceConfigSyncEvent> {
    const prior = this.pendingConfig.get(deviceId);
    if (prior) clearTimeout(prior.timeout);
    await this.publish(
      `${this.tenant}/esp32/${deviceId}/down/command`,
      command,
    );
    const commandId = command.command_id as string;
    const event: DeviceConfigSyncEvent = {
      deviceId,
      commandId,
      kind,
      desiredRevision: revision,
      appliedRevision: null,
      status: 'PENDING',
      error: null,
      updatedAt: new Date().toISOString(),
    };
    const timeout = setTimeout(() => {
      const pending = this.pendingConfig.get(deviceId);
      if (
        !pending ||
        pending.commandId !== commandId ||
        pending.status === 'APPLIED'
      )
        return;
      this.publishConfigSync({
        ...pending,
        status: 'TIMEOUT',
        error: {
          code: 'ACK_TIMEOUT',
          message: 'No device acknowledgement within 15 seconds.',
        },
        updatedAt: new Date().toISOString(),
      });
      this.pendingConfig.delete(deviceId);
    }, 15_000);
    this.pendingConfig.set(deviceId, { ...event, timeout });
    this.publishConfigSync(event);
    return event;
  }

  private applyConfigAck(ack: CommandAckEvent): void {
    const pending = this.pendingConfig.get(ack.deviceId);
    if (!pending || pending.commandId !== ack.commandId) return;
    if (
      ack.status !== 'SUCCESS' ||
      ack.resultKind !== pending.kind ||
      ack.configRevision !== pending.desiredRevision
    ) {
      clearTimeout(pending.timeout);
      this.pendingConfig.delete(ack.deviceId);
      this.publishConfigSync({
        ...pending,
        status: 'FAILED',
        error: ack.error ?? {
          code: 'ACK_INVALID',
          message: 'Device rejected config command.',
        },
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    this.publishConfigSync({
      ...pending,
      status: 'ACKED',
      updatedAt: new Date().toISOString(),
    });
  }

  private confirmAppliedFromTelemetry(
    deviceId: string,
    revision: number | null,
  ): void {
    const pending = this.pendingConfig.get(deviceId);
    if (!pending || revision === null || revision !== pending.desiredRevision)
      return;
    clearTimeout(pending.timeout);
    this.pendingConfig.delete(deviceId);
    this.publishConfigSync({
      ...pending,
      appliedRevision: revision,
      status: 'APPLIED',
      updatedAt: new Date().toISOString(),
    });
  }

  private publishConfigSync(event: DeviceConfigSyncEvent): void {
    const { timeout: _timeout, ...safeEvent } =
      event as DeviceConfigSyncEvent & { timeout?: NodeJS.Timeout };
    this.configSyncCache.set(event.deviceId, safeEvent);
    this.configSync$.next(safeEvent);
  }

  private async publish(
    topic: string,
    payload: unknown,
    retain = false,
  ): Promise<void> {
    if (!this.client?.connected)
      throw new Error('MQTT client is not connected.');
    await new Promise<void>((resolve, reject) => {
      this.client?.publish(
        topic,
        JSON.stringify(payload),
        { qos: 1, retain },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  }

  getAllDeviceStatuses(): DeviceStatusEvent[] {
    return Array.from(this.deviceStateCache.values());
  }

  private nonNegativeInteger(value: unknown): number | null {
    return typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0
      ? value
      : null;
  }

  /** Strict v1 parser: rejects arrays, omitted fields, and forward-compatible extras. */
  private parseTuningSnapshot(value: unknown): TuningConfigSnapshot | null {
    const config = this.object(value);
    const expected = [
      'lamp_gain_scale',
      'mist_gain_scale',
      'mist_on_threshold',
      'mist_off_threshold',
    ];
    if (!config || Object.keys(config).length !== expected.length || !expected.every((key) => key in config)) return null;
    const lamp = config.lamp_gain_scale;
    const mist = config.mist_gain_scale;
    const on = config.mist_on_threshold;
    const off = config.mist_off_threshold;
    if (
      typeof lamp !== 'number' || !Number.isFinite(lamp) ||
      typeof mist !== 'number' || !Number.isFinite(mist) ||
      typeof on !== 'number' || !Number.isFinite(on) ||
      typeof off !== 'number' || !Number.isFinite(off)
    ) return null;
    if (lamp < LAMP_GAIN_SCALE_MIN || lamp > LAMP_GAIN_SCALE_MAX ||
      mist < MIST_GAIN_SCALE_MIN || mist > MIST_GAIN_SCALE_MAX ||
      on < MIST_ON_THRESHOLD_MIN || on > MIST_ON_THRESHOLD_MAX ||
      off < MIST_OFF_THRESHOLD_MIN || off > MIST_OFF_THRESHOLD_MAX ||
      off >= on - MIN_THRESHOLD_GAP) return null;
    return {
      lamp_gain_scale: lamp,
      mist_gain_scale: mist,
      mist_on_threshold: on,
      mist_off_threshold: off,
    };
  }

  private finiteMetric(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private refreshUnknownDevice(deviceId: string): void {
    if (this.unknownRefreshes.has(deviceId)) return;
    this.unknownRefreshes.add(deviceId);
    void this.registry
      .refreshOne(deviceId)
      .catch((error: unknown) =>
        this.logger.warn(
          `Registry refresh failed for '${deviceId}': ${String(error)}`,
        ),
      )
      .finally(() => this.unknownRefreshes.delete(deviceId));
  }
}
