// DURABILITY GATE for Track L L1–L3 (see WALKTHROUGH_LOG / PROGRESS Note).
//
// This is the real-infrastructure release gate the component harness in
// `test/tuning/fault-injection.e2e-spec.ts` intentionally does NOT cover. It
// drives the REAL production services (MqttService, TuningConfigurationService,
// TuningMqttOutboxDispatcher, DeviceRegistryService) against:
//   - a real PostgreSQL instance (row-lock + transaction commit/restart), and
//   - a real MQTT broker with retained + QoS-1 delivery.
// It asserts the three fault-injection scenarios end-to-end AFTER commit and
// re-reads durable state through a fresh connection to prove it survives a
// process restart:
//   L1 offline → reconnect retained delivery → durable PENDING→IN_SYNC ACK
//   L2 duplicate QoS-1 ACCEPTED ACK → single durable transition (row-lock)
//   L3 stale ACK for command A after newer desired B → retained B not cleared
//
// It is excluded from the default `npm test` run and only executes in the
// dedicated CI job that supplies TUNING_MIGRATION_DATABASE_URL plus the MQTT_*
// broker env (npm run test:tuning:durability:integration).
import { DataSource, Repository } from 'typeorm';
import * as mqtt from 'mqtt';
import { MushroomHouse } from '../../batch/entities/mushroom-house.entity';
import { Device } from '../../device/entities/device.entity';
import { DeviceRegistryService } from '../../device/device-registry.service';
import { MqttService } from '../../mqtt/mqtt.service';
import { AppConfigService } from '../../config/config.service';
import {
  getTuningDesiredTopic,
  getTuningReportedTopic,
} from '../../mqtt/constants/mqtt-topics.const';
import {
  DeviceTuningConfiguration,
  SyncStatus,
  TuningConfigSnapshot,
} from '../entities/device-tuning-configuration.entity';
import { TuningAuditLog } from '../entities/tuning-audit-log.entity';
import { TuningMqttOutbox } from '../entities/tuning-mqtt-outbox.entity';
import {
  TuningConfigurationService,
  TuningPrincipal,
  TuningSyncEvent,
} from './tuning-configuration.service';
import { TuningMqttOutboxDispatcher } from './tuning-mqtt-outbox-dispatcher.service';
import { CreateDeviceTuningConfigurations1720656000006 } from '../../database/migrations/1720656000006-create-device-tuning-configurations';
import { CreateTuningAuditLogs1720656000007 } from '../../database/migrations/1720656000007-create-tuning-audit-logs';
import { HardenTuningShadow1720656000008 } from '../../database/migrations/1720656000008-harden-tuning-shadow';
import { CreateTuningMqttOutbox1720656000009 } from '../../database/migrations/1720656000009-create-tuning-mqtt-outbox';
import { AddReportedTuningShadow1720656000010 } from '../../database/migrations/1720656000010-add-reported-tuning-shadow';
import { AddTuningMqttOutboxLease1720656000014 } from '../../database/migrations/1720656000014-add-tuning-mqtt-outbox-lease';

const TENANT = 'fault_it';
const DEVICE_ID = 'mushroom_s3_durability_it';
const HOUSE_ID = 'house_it';
const OWNER = 'owner-it';
const COMMAND_A = '11111111-1111-4111-8111-111111111111';
const COMMAND_B = '22222222-2222-4222-8222-222222222222';
const CONFIG_A: TuningConfigSnapshot = {
  lamp_gain_scale: 1.05,
  mist_gain_scale: 0.95,
  mist_on_threshold: 0.28,
  mist_off_threshold: 0.18,
};
const CONFIG_B: TuningConfigSnapshot = {
  lamp_gain_scale: 1.1,
  mist_gain_scale: 0.9,
  mist_on_threshold: 0.3,
  mist_off_threshold: 0.19,
};
const PRINCIPAL: TuningPrincipal = {
  subject: 'operator@it',
  allowedHouseIds: [HOUSE_ID],
  isAdmin: true,
};

interface BrokerEnv {
  readonly url: string;
  readonly username: string;
  readonly password: string;
}

interface Stack {
  readonly mqtt: MqttService;
  readonly tuning: TuningConfigurationService;
  readonly dispatcher: TuningMqttOutboxDispatcher;
  readonly registry: DeviceRegistryService;
  readonly sseEvents: TuningSyncEvent[];
}

const ENTITIES = [
  MushroomHouse,
  Device,
  DeviceTuningConfiguration,
  TuningAuditLog,
  TuningMqttOutbox,
];

function requireDbUrl(): string {
  const url = process.env.TUNING_MIGRATION_DATABASE_URL;
  if (!url)
    throw new Error(
      '[tuning-durability-it] TUNING_MIGRATION_DATABASE_URL is required.',
    );
  return url;
}

function requireBroker(): BrokerEnv {
  const host = process.env.MQTT_HOST;
  const port = process.env.MQTT_PORT;
  const username = process.env.MQTT_USERNAME ?? process.env.MQTT_BACKEND_USER;
  const password = process.env.MQTT_PASSWORD ?? process.env.MQTT_BACKEND_PASS;
  if (!host || !port || !username || !password)
    throw new Error(
      '[tuning-durability-it] MQTT_HOST, MQTT_PORT, MQTT_USERNAME and MQTT_PASSWORD are required.',
    );
  return { url: `mqtt://${host}:${port}`, username, password };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(
    '[tuning-durability-it] timed out waiting for durable state.',
  );
}

function newDataSource(): DataSource {
  return new DataSource({
    type: 'postgres',
    url: requireDbUrl(),
    synchronize: false,
    entities: ENTITIES,
  });
}

async function resetSchema(ds: DataSource): Promise<void> {
  const runner = ds.createQueryRunner();
  await runner.query('DROP SCHEMA IF EXISTS public CASCADE');
  await runner.query('CREATE SCHEMA public');
  await runner.query(`
    CREATE TABLE devices (
      device_id VARCHAR(50) PRIMARY KEY,
      house_id VARCHAR(50) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      display_name VARCHAR(100),
      mqtt_username VARCHAR(50) NOT NULL UNIQUE,
      owner_user_id VARCHAR(255) NOT NULL,
      token VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  const chain = [
    new CreateDeviceTuningConfigurations1720656000006(),
    new CreateTuningAuditLogs1720656000007(),
    new HardenTuningShadow1720656000008(),
    new CreateTuningMqttOutbox1720656000009(),
    new AddReportedTuningShadow1720656000010(),
    new AddTuningMqttOutboxLease1720656000014(),
  ];
  for (const migration of chain) await migration.up(runner);
  await runner.release();
}

async function seedDevice(ds: DataSource): Promise<void> {
  await ds.getRepository(Device).query(
    `INSERT INTO devices(device_id, house_id, enabled, mqtt_username, owner_user_id)
     VALUES ($1, $2, TRUE, $1, $3)`,
    [DEVICE_ID, HOUSE_ID, OWNER],
  );
}

function buildStack(ds: DataSource): Stack {
  process.env.IOT_TENANT = TENANT;
  const registry = new DeviceRegistryService(ds.getRepository(Device));
  const config = new AppConfigService();
  const mqttSvc = new MqttService(
    registry,
    ds.getRepository(Device),
    {} as never,
    config,
  );
  const outboxRepo = ds.getRepository(
    TuningMqttOutbox,
  ) as Repository<TuningMqttOutbox>;
  const dispatcher = new TuningMqttOutboxDispatcher(ds, outboxRepo, mqttSvc);
  const tuning = new TuningConfigurationService(
    ds,
    ds.getRepository(DeviceTuningConfiguration),
    ds.getRepository(TuningAuditLog),
    mqttSvc,
    dispatcher,
  );
  const sseEvents: TuningSyncEvent[] = [];
  tuning.tuningSync$.subscribe((event) => sseEvents.push(event));
  return { mqtt: mqttSvc, tuning, dispatcher, registry, sseEvents };
}

async function startStack(stack: Stack): Promise<void> {
  await stack.registry.loadAll();
  stack.mqtt.onModuleInit();
  stack.tuning.onModuleInit();
  await waitUntil(
    () =>
      (stack.mqtt as unknown as { client?: { connected?: boolean } }).client
        ?.connected === true,
  );
}

function stopStack(stack: Stack): void {
  stack.tuning.onModuleDestroy();
  stack.dispatcher.onModuleDestroy();
  stack.mqtt.onModuleDestroy();
}

function connectEdge(broker: BrokerEnv): mqtt.MqttClient {
  return mqtt.connect(broker.url, {
    username: broker.username,
    password: broker.password,
    clientId: DEVICE_ID,
    clean: true,
    reconnectPeriod: 0,
  });
}

function waitEdgeConnected(client: mqtt.MqttClient): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('error', reject);
  });
}

function publishReportedAck(
  client: mqtt.MqttClient,
  commandId: string,
  revision: number,
  config: TuningConfigSnapshot,
): Promise<void> {
  const topic = getTuningReportedTopic(TENANT, DEVICE_ID);
  const payload = JSON.stringify({
    schema_version: 1,
    command_id: commandId,
    device_id: DEVICE_ID,
    revision,
    status: 'ACCEPTED',
    reason_code: null,
    persisted: true,
    reported_config: config,
  });
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, { qos: 1 }, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

async function readRetained(
  broker: BrokerEnv,
  timeoutMs = 1_500,
): Promise<string | null> {
  const sniffer = mqtt.connect(broker.url, {
    username: broker.username,
    password: broker.password,
    clientId: `${DEVICE_ID}_sniff_${Date.now()}`,
    clean: true,
    reconnectPeriod: 0,
  });
  const topic = getTuningDesiredTopic(TENANT, DEVICE_ID);
  try {
    await waitEdgeConnected(sniffer);
    return await new Promise<string | null>((resolve) => {
      let received: string | null = null;
      sniffer.on('message', (_t, payload) => {
        received = payload.toString();
      });
      sniffer.subscribe(topic, { qos: 1 }, () =>
        setTimeout(() => resolve(received), timeoutMs),
      );
    });
  } finally {
    sniffer.end(true);
  }
}

async function freshDurableRead(): Promise<{
  config: DeviceTuningConfiguration | null;
  audits: number;
}> {
  // A brand-new DataSource proves the transition is committed to disk and not
  // an artifact of the writer process' in-memory state (post-restart proof).
  const ds = newDataSource();
  await ds.initialize();
  try {
    const config = await ds.getRepository(DeviceTuningConfiguration).findOne({
      where: { deviceId: DEVICE_ID, commandId: COMMAND_A },
    });
    const audits = await ds
      .getRepository(TuningAuditLog)
      .count({ where: { deviceId: DEVICE_ID } });
    return { config, audits };
  } finally {
    await ds.destroy();
  }
}

describe('Tuning durability gate (real PostgreSQL + real retained/QoS-1 broker)', () => {
  let ds: DataSource;
  let broker: BrokerEnv;

  beforeAll(() => {
    requireDbUrl();
    broker = requireBroker();
  });

  beforeEach(async () => {
    ds = newDataSource();
    await ds.initialize();
    await resetSchema(ds);
    await ds.destroy();
    ds = newDataSource();
    await ds.initialize();
    await seedDevice(ds);
  }, 60_000);

  afterEach(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('L1: delivers retained desired on reconnect and durably commits PENDING→IN_SYNC', async () => {
    const stack = buildStack(ds);
    await startStack(stack);
    const edge = connectEdge(broker);
    const desiredTopic = getTuningDesiredTopic(TENANT, DEVICE_ID);

    // Device is offline: publish retained desired while nothing is subscribed.
    await stack.tuning.createPendingCommand(
      PRINCIPAL,
      DEVICE_ID,
      CONFIG_A,
      COMMAND_A,
    );
    await waitUntil(async () => (await readRetained(broker)) !== null);

    // Reconnect: broker must deliver the retained desired to the edge.
    const delivered = new Promise<Record<string, unknown>>((resolve) => {
      edge.on('message', (_t, payload) =>
        resolve(JSON.parse(payload.toString()) as Record<string, unknown>),
      );
    });
    await waitEdgeConnected(edge);
    edge.subscribe(desiredTopic, { qos: 1 });
    const desired = await delivered;
    expect(desired).toMatchObject({ command_id: COMMAND_A, revision: 1 });

    await publishReportedAck(edge, COMMAND_A, 1, CONFIG_A);
    await waitUntil(async () => {
      const row = await stack.tuning.getLatestByDeviceId(DEVICE_ID);
      return row?.status === SyncStatus.IN_SYNC;
    });

    // Retained is cleared and durable state survives a fresh connection.
    await waitUntil(async () => (await readRetained(broker)) === null);
    stopStack(stack);
    edge.end(true);
    const durable = await freshDurableRead();
    expect(durable.config?.status).toBe(SyncStatus.IN_SYNC);
    expect(durable.audits).toBeGreaterThanOrEqual(2);
    expect(stack.sseEvents.at(-1)?.status).toBe(SyncStatus.IN_SYNC);
  }, 60_000);

  it('L2: applies a duplicate QoS-1 ACCEPTED ACK exactly once under a real row lock', async () => {
    const stack = buildStack(ds);
    await startStack(stack);
    const edge = connectEdge(broker);
    await waitEdgeConnected(edge);

    await stack.tuning.createPendingCommand(
      PRINCIPAL,
      DEVICE_ID,
      CONFIG_A,
      COMMAND_A,
    );
    await publishReportedAck(edge, COMMAND_A, 1, CONFIG_A);
    await waitUntil(async () => {
      const row = await stack.tuning.getLatestByDeviceId(DEVICE_ID);
      return row?.status === SyncStatus.IN_SYNC;
    });
    const afterFirst = await freshDurableRead();
    const sseAfterFirst = stack.sseEvents.length;

    // Reinject the identical ACK (QoS-1 redelivery). The pessimistic row lock
    // must observe IN_SYNC and skip: no second transition, audit or SSE.
    await publishReportedAck(edge, COMMAND_A, 1, CONFIG_A);
    await delay(2_000);
    const afterDuplicate = await freshDurableRead();
    stopStack(stack);
    edge.end(true);

    expect(afterDuplicate.config?.updatedAt.toISOString()).toBe(
      afterFirst.config?.updatedAt.toISOString(),
    );
    expect(afterDuplicate.audits).toBe(afterFirst.audits);
    expect(stack.sseEvents.length).toBe(sseAfterFirst);
  }, 60_000);

  it('L3: a stale ACK for command A does not clear retained desired B', async () => {
    const stack = buildStack(ds);
    await startStack(stack);
    const edge = connectEdge(broker);
    await waitEdgeConnected(edge);

    await stack.tuning.createPendingCommand(
      PRINCIPAL,
      DEVICE_ID,
      CONFIG_A,
      COMMAND_A,
    );
    await publishReportedAck(edge, COMMAND_A, 1, CONFIG_A);
    await waitUntil(async () => {
      const row = await stack.tuning.getLatestByDeviceId(DEVICE_ID);
      return row?.status === SyncStatus.IN_SYNC;
    });

    // Newer desired B becomes the latest pending + the retained payload.
    await stack.tuning.createPendingCommand(
      PRINCIPAL,
      DEVICE_ID,
      CONFIG_B,
      COMMAND_B,
    );
    await waitUntil(async () => {
      const retained = await readRetained(broker);
      return retained !== null && retained.includes(COMMAND_B);
    });

    // Stale ACK for A arrives late; latest-pending guard must keep retained B.
    await publishReportedAck(edge, COMMAND_A, 1, CONFIG_A);
    await delay(2_000);
    const retainedAfter = await readRetained(broker);
    stopStack(stack);
    edge.end(true);
    expect(retainedAfter).not.toBeNull();
    expect(retainedAfter).toContain(COMMAND_B);
  }, 60_000);
});
