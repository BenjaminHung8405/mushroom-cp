import { DataSource, EntityManager, Repository } from 'typeorm';
import { Device } from '../../src/device/entities/device.entity';
import { MqttService } from '../../src/mqtt/mqtt.service';
import { getTuningDesiredTopic } from '../../src/mqtt/constants/mqtt-topics.const';
import {
  DeviceTuningConfiguration,
  SyncStatus,
  TuningConfigSnapshot,
} from '../../src/tuning/entities/device-tuning-configuration.entity';
import { TuningAuditLog } from '../../src/tuning/entities/tuning-audit-log.entity';
import {
  TuningConfigurationService,
  TuningSyncEvent,
} from '../../src/tuning/services/tuning-configuration.service';
import { TuningMqttOutboxDispatcher } from '../../src/tuning/services/tuning-mqtt-outbox-dispatcher.service';

const TENANT = 'fault_test';
const DEVICE_ID = 'mushroom_s3_fault_test';
const COMMAND_ID = '12345678-1234-4234-8234-1234567890ab';
const COMMAND_B_ID = '22345678-1234-4234-8234-1234567890ab';
const CONFIG: TuningConfigSnapshot = {
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

interface PublishOptions {
  readonly qos: number;
  readonly retain: boolean;
}

interface PublishedPacket extends PublishOptions {
  readonly topic: string;
  readonly payload: string;
}

interface DesiredEnvelope {
  readonly schema_version: number;
  readonly command_id: string;
  readonly device_id: string;
  readonly revision: number;
  readonly config: TuningConfigSnapshot;
}

class RetainedBrokerHarness {
  readonly packets: PublishedPacket[] = [];
  readonly backendClient = {
    connected: true,
    publish: (
      topic: string,
      payload: string,
      options: PublishOptions,
      callback?: (error?: Error) => void,
    ): void => {
      this.acceptBackendPublish(topic, payload, options);
      callback?.();
    },
  };

  private readonly retained = new Map<string, string>();
  private edgeReceiver: ((topic: string, payload: string) => void) | null =
    null;
  private backendReceiver: ((topic: string, payload: Buffer) => void) | null =
    null;

  setBackendReceiver(receiver: (topic: string, payload: Buffer) => void): void {
    this.backendReceiver = receiver;
  }

  connectEdge(receiver: (topic: string, payload: string) => void): void {
    this.edgeReceiver = receiver;
    for (const [topic, payload] of this.retained) receiver(topic, payload);
  }

  publishFromEdge(topic: string, payload: string): void {
    this.packets.push({ topic, payload, qos: 1, retain: false });
    this.backendReceiver?.(topic, Buffer.from(payload));
  }

  reinjectReportedAck(): void {
    const reportedTopic = `${TENANT}/esp32/${DEVICE_ID}/up/tuning/reported`;
    const accepted = this.packets.find(
      (packet) => packet.topic === reportedTopic && packet.payload.length > 0,
    );
    if (!accepted) throw new Error('No reported ACK is available to reinject.');
    this.packets.push({ ...accepted });
    this.backendReceiver?.(accepted.topic, Buffer.from(accepted.payload));
  }

  retainedPayload(topic: string): string | null {
    return this.retained.get(topic) ?? null;
  }

  private acceptBackendPublish(
    topic: string,
    payload: string,
    options: PublishOptions,
  ): void {
    this.packets.push({ topic, payload, ...options });
    if (options.retain) {
      if (payload.length === 0) this.retained.delete(topic);
      else this.retained.set(topic, payload);
    }
    if (this.edgeReceiver) this.edgeReceiver(topic, payload);
  }
}

class TwoSlotNvsHarness {
  writes = 0;
  commits = 0;
  persisted: DesiredEnvelope | null = null;

  persist(envelope: DesiredEnvelope): void {
    // Firmware writes PENDING then READY records in alternating CRC slots.
    this.writes += 2;
    this.commits += 1;
    this.persisted = structuredClone(envelope);
  }
}

class EdgeHarness {
  desiredDeliveries = 0;

  constructor(
    private readonly broker: RetainedBrokerHarness,
    readonly nvs: TwoSlotNvsHarness,
  ) {}

  connect(): void {
    this.broker.connectEdge((topic, payload) =>
      this.handleDesired(topic, payload),
    );
  }

  private handleDesired(topic: string, payload: string): void {
    if (topic !== getTuningDesiredTopic(TENANT, DEVICE_ID) || !payload) return;
    this.desiredDeliveries += 1;
    const desired = JSON.parse(payload) as DesiredEnvelope;
    this.assertDesiredContract(desired);
    this.nvs.persist(desired);
    this.publishAccepted(desired);
  }

  private assertDesiredContract(desired: DesiredEnvelope): void {
    if (
      desired.schema_version !== 1 ||
      desired.device_id !== DEVICE_ID ||
      desired.command_id !== COMMAND_ID ||
      desired.revision !== 1
    ) {
      throw new Error('Edge received an invalid desired tuning envelope.');
    }
  }

  private publishAccepted(desired: DesiredEnvelope): void {
    const topic = `${TENANT}/esp32/${DEVICE_ID}/up/tuning/reported`;
    this.broker.publishFromEdge(
      topic,
      JSON.stringify({
        schema_version: 1,
        command_id: desired.command_id,
        device_id: desired.device_id,
        revision: desired.revision,
        status: 'ACCEPTED',
        reason_code: null,
        persisted: true,
        reported_config: desired.config,
      }),
    );
  }
}

interface DurableHarness {
  readonly pending: DeviceTuningConfiguration;
  readonly audits: TuningAuditLog[];
  dataSource: DataSource;
  configRepo: Repository<DeviceTuningConfiguration>;
  transactionCommitted: boolean;
  transactionCount: number;
  lockedCommandReads: number;
  retainedClearEnqueues: number;
  outboxDispatches: number;
}

describe('Tuning retained desired fault injection (e2e)', () => {
  it('should deliver retained desired to device on reconnect', async () => {
    const broker = new RetainedBrokerHarness();
    const mqtt = createMqttService(broker);
    const durable = createDurableHarness();
    const outbox = createOutboxHarness(mqtt, durable);
    const service = createTuningService(mqtt, durable, outbox);
    const edge = new EdgeHarness(broker, new TwoSlotNvsHarness());
    const sseEvents: TuningSyncEvent[] = [];
    service.tuningSync$.subscribe((event) => {
      expect(durable.transactionCommitted).toBe(true);
      sseEvents.push(event);
    });
    service.onModuleInit();

    const desiredTopic = getTuningDesiredTopic(TENANT, DEVICE_ID);
    await mqtt.publishTuningDesired(DEVICE_ID, COMMAND_ID, 1, CONFIG);

    expectOfflineRetainedState(broker, edge, desiredTopic);
    edge.connect();
    await waitUntil(() => durable.pending.status === SyncStatus.IN_SYNC);

    expectSyncedState(durable, edge, sseEvents);
    expect(broker.retainedPayload(desiredTopic)).toBeNull();
    service.onModuleDestroy();
  });

  it('should ignore a duplicate QoS-1 ACCEPTED ACK without side effects', async () => {
    const broker = new RetainedBrokerHarness();
    const mqtt = createMqttService(broker);
    const durable = createDurableHarness();
    const outbox = createOutboxHarness(mqtt, durable);
    const service = createTuningService(mqtt, durable, outbox);
    const sseEvents: TuningSyncEvent[] = [];
    service.tuningSync$.subscribe((event) => sseEvents.push(event));
    service.onModuleInit();

    await mqtt.publishTuningDesired(DEVICE_ID, COMMAND_ID, 1, CONFIG);
    const edge = new EdgeHarness(broker, new TwoSlotNvsHarness());
    edge.connect();
    await waitUntil(() => durable.pending.status === SyncStatus.IN_SYNC);

    const stateAfterFirstAck = snapshotDurableState(durable.pending);
    const sideEffectsAfterFirstAck = {
      audits: durable.audits.length,
      sse: sseEvents.length,
      retainedClears: retainedClearCount(broker),
      outboxEnqueues: durable.retainedClearEnqueues,
      outboxDispatches: durable.outboxDispatches,
      transactions: durable.transactionCount,
      lockedReads: durable.lockedCommandReads,
    };

    broker.reinjectReportedAck();
    await waitUntil(
      () =>
        durable.transactionCount > sideEffectsAfterFirstAck.transactions &&
        durable.transactionCommitted,
    );

    expect(durable.lockedCommandReads).toBe(
      sideEffectsAfterFirstAck.lockedReads + 1,
    );
    expect(snapshotDurableState(durable.pending)).toEqual(stateAfterFirstAck);
    expect(durable.audits).toHaveLength(sideEffectsAfterFirstAck.audits);
    expect(sseEvents).toHaveLength(sideEffectsAfterFirstAck.sse);
    expect(retainedClearCount(broker)).toBe(
      sideEffectsAfterFirstAck.retainedClears,
    );
    expect(durable.retainedClearEnqueues).toBe(
      sideEffectsAfterFirstAck.outboxEnqueues,
    );
    expect(durable.outboxDispatches).toBe(
      sideEffectsAfterFirstAck.outboxDispatches,
    );
    service.onModuleDestroy();
  });

  it('should not clear retained command B when an old ACK for command A arrives', async () => {
    const broker = new RetainedBrokerHarness();
    const mqtt = createMqttService(broker);
    const commandA = syncedConfiguration();
    const commandB = pendingConfigurationB();
    const durable = createOutOfOrderDurableHarness(commandA, commandB);
    const outbox = createOutboxHarness(mqtt, durable);
    const service = createTuningService(mqtt, durable, outbox);
    const sseEvents: TuningSyncEvent[] = [];
    service.tuningSync$.subscribe((event) => sseEvents.push(event));
    service.onModuleInit();

    const desiredTopic = getTuningDesiredTopic(TENANT, DEVICE_ID);
    await mqtt.publishTuningDesired(DEVICE_ID, COMMAND_B_ID, 2, CONFIG_B);
    const retainedCommandB = broker.retainedPayload(desiredTopic);
    expect(JSON.parse(retainedCommandB ?? '{}')).toMatchObject({
      command_id: COMMAND_B_ID,
      revision: 2,
      config: CONFIG_B,
    });

    const commandABefore = snapshotDurableState(commandA);
    const commandBBefore = snapshotDurableState(commandB);
    broker.publishFromEdge(
      `${TENANT}/esp32/${DEVICE_ID}/up/tuning/reported`,
      JSON.stringify({
        schema_version: 1,
        command_id: COMMAND_ID,
        device_id: DEVICE_ID,
        revision: 1,
        status: 'ACCEPTED',
        reason_code: null,
        persisted: true,
        reported_config: CONFIG,
      }),
    );
    await waitUntil(
      () => durable.transactionCount === 1 && durable.transactionCommitted,
    );

    expect(durable.lockedCommandReads).toBe(1);
    expect(snapshotDurableState(commandA)).toEqual(commandABefore);
    expect(snapshotDurableState(commandB)).toEqual(commandBBefore);
    expect(durable.audits).toHaveLength(0);
    expect(sseEvents).toHaveLength(0);
    expect(durable.retainedClearEnqueues).toBe(0);
    expect(durable.outboxDispatches).toBe(0);
    expect(retainedClearCount(broker)).toBe(0);
    expect(broker.retainedPayload(desiredTopic)).toBe(retainedCommandB);
    service.onModuleDestroy();
  });
});

function createMqttService(broker: RetainedBrokerHarness): MqttService {
  const registry = {
    getEnabled: (deviceId: string) =>
      deviceId === DEVICE_ID ? { deviceId, houseId: 'house-1' } : null,
    touchLastSeen: jest.fn().mockResolvedValue(undefined),
  };
  const mqtt = new MqttService(
    registry as never,
    {} as Repository<Device>,
    {} as never,
    { getTenant: () => TENANT } as never,
  );
  const internals = mqtt as unknown as {
    client: typeof broker.backendClient;
    handleIncomingMessage(topic: string, payload: Buffer): void;
  };
  internals.client = broker.backendClient;
  broker.setBackendReceiver((topic, payload) =>
    internals.handleIncomingMessage(topic, payload),
  );
  return mqtt;
}

function createDurableHarness(): DurableHarness {
  const pending = pendingConfiguration();
  const audits: TuningAuditLog[] = [];
  const harness = {
    pending,
    audits,
    transactionCommitted: false,
    transactionCount: 0,
    lockedCommandReads: 0,
    retainedClearEnqueues: 0,
    outboxDispatches: 0,
  } as DurableHarness;
  const manager = createEntityManager(harness);
  harness.dataSource = {
    transaction: async <T>(
      work: (entityManager: EntityManager) => Promise<T>,
    ) => {
      harness.transactionCount += 1;
      harness.transactionCommitted = false;
      const result = await work(manager);
      harness.transactionCommitted = true;
      return result;
    },
  } as DataSource;
  harness.configRepo = {
    findOne: jest.fn().mockImplementation(() => Promise.resolve(pending)),
  } as unknown as Repository<DeviceTuningConfiguration>;
  return harness;
}

function createOutOfOrderDurableHarness(
  commandA: DeviceTuningConfiguration,
  commandB: DeviceTuningConfiguration,
): DurableHarness {
  const audits: TuningAuditLog[] = [];
  const harness = {
    pending: commandA,
    audits,
    transactionCommitted: false,
    transactionCount: 0,
    lockedCommandReads: 0,
    retainedClearEnqueues: 0,
    outboxDispatches: 0,
  } as DurableHarness;
  const manager = {
    findOne: jest.fn().mockImplementation(
      (
        entity: unknown,
        options: {
          where?: { commandId?: string };
          lock?: { mode: string };
          order?: { revision?: string };
        },
      ) => {
        if (entity !== DeviceTuningConfiguration) return Promise.resolve(null);
        if (options.lock) {
          harness.lockedCommandReads += 1;
          return Promise.resolve(
            options.where?.commandId === COMMAND_ID ? commandA : null,
          );
        }
        if (options.order?.revision === 'DESC')
          return Promise.resolve(commandB);
        return Promise.resolve(null);
      },
    ),
    create: jest.fn((_entity: unknown, value: object) => value),
    save: jest.fn().mockImplementation((entity: unknown, value: unknown) => {
      if (entity === TuningAuditLog) audits.push(value as TuningAuditLog);
      return Promise.resolve(value);
    }),
  } as unknown as EntityManager;
  harness.dataSource = {
    transaction: async <T>(
      work: (entityManager: EntityManager) => Promise<T>,
    ) => {
      harness.transactionCount += 1;
      harness.transactionCommitted = false;
      const result = await work(manager);
      harness.transactionCommitted = true;
      return result;
    },
  } as DataSource;
  harness.configRepo = {} as Repository<DeviceTuningConfiguration>;
  return harness;
}

function createEntityManager(harness: DurableHarness): EntityManager {
  return {
    findOne: jest
      .fn()
      .mockImplementation(
        (entity: unknown, options: { where?: { status?: SyncStatus } }) => {
          if (entity !== DeviceTuningConfiguration)
            return Promise.resolve(null);
          if ('lock' in options) harness.lockedCommandReads += 1;
          if (options.where?.status === SyncStatus.IN_SYNC)
            return Promise.resolve(null);
          return Promise.resolve(harness.pending);
        },
      ),
    create: jest.fn((_entity: unknown, value: object) => value),
    save: jest.fn().mockImplementation((entity: unknown, value: unknown) => {
      if (entity === TuningAuditLog)
        harness.audits.push(value as TuningAuditLog);
      return Promise.resolve(value);
    }),
  } as unknown as EntityManager;
}

function createOutboxHarness(
  mqtt: MqttService,
  durable: DurableHarness,
): TuningMqttOutboxDispatcher {
  let retainedClearQueued = false;
  return {
    enqueueRetainedClear: jest.fn().mockImplementation(() => {
      durable.retainedClearEnqueues += 1;
      retainedClearQueued = true;
      return Promise.resolve({});
    }),
    dispatchDue: jest.fn().mockImplementation(async () => {
      durable.outboxDispatches += 1;
      if (!retainedClearQueued) return;
      expect(durable.transactionCommitted).toBe(true);
      retainedClearQueued = false;
      await mqtt.clearTuningDesired(DEVICE_ID);
    }),
  } as unknown as TuningMqttOutboxDispatcher;
}

function createTuningService(
  mqtt: MqttService,
  durable: DurableHarness,
  outbox: TuningMqttOutboxDispatcher,
): TuningConfigurationService {
  return new TuningConfigurationService(
    durable.dataSource,
    durable.configRepo,
    {} as Repository<TuningAuditLog>,
    mqtt,
    outbox,
  );
}

function pendingConfiguration(): DeviceTuningConfiguration {
  const timestamp = new Date('2026-07-27T00:00:00.000Z');
  return {
    id: '12345678-1234-4234-8234-1234567890ac',
    deviceId: DEVICE_ID,
    commandId: COMMAND_ID,
    revision: 1,
    status: SyncStatus.PENDING,
    config: CONFIG,
    reportedConfig: null,
    reportedRevision: null,
    appliedAt: null,
    rejectionReason: null,
    publishedAt: timestamp,
    retainedClearPending: false,
    retainedClearAttempts: 0,
    retainedClearNextAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function syncedConfiguration(): DeviceTuningConfiguration {
  const config = pendingConfiguration();
  config.status = SyncStatus.IN_SYNC;
  config.reportedConfig = CONFIG;
  config.reportedRevision = 1;
  config.appliedAt = new Date('2026-07-27T00:01:00.000Z');
  return config;
}

function pendingConfigurationB(): DeviceTuningConfiguration {
  const config = pendingConfiguration();
  config.id = '22345678-1234-4234-8234-1234567890ac';
  config.commandId = COMMAND_B_ID;
  config.revision = 2;
  config.config = CONFIG_B;
  return config;
}

function expectOfflineRetainedState(
  broker: RetainedBrokerHarness,
  edge: EdgeHarness,
  topic: string,
): void {
  expect(edge.desiredDeliveries).toBe(0);
  expect(broker.retainedPayload(topic)).not.toBeNull();
  expect(broker.packets[0]).toMatchObject({ topic, qos: 1, retain: true });
}

function expectSyncedState(
  durable: DurableHarness,
  edge: EdgeHarness,
  sseEvents: TuningSyncEvent[],
): void {
  expect(durable.pending).toMatchObject({
    status: SyncStatus.IN_SYNC,
    reportedConfig: CONFIG,
    reportedRevision: 1,
    rejectionReason: null,
  });
  expect(durable.audits).toHaveLength(1);
  expect(durable.audits[0]).toMatchObject({
    action: 'SYNC_ACCEPTED',
    source: 'mqtt',
    result: 'SUCCESS',
  });
  expect(sseEvents).toHaveLength(1);
  expect(sseEvents[0]).toMatchObject({
    commandId: COMMAND_ID,
    status: SyncStatus.IN_SYNC,
  });
  expect(edge.desiredDeliveries).toBe(1);
  expect(edge.nvs.commits).toBe(1);
  expect(edge.nvs.writes).toBe(2);
}

function retainedClearCount(broker: RetainedBrokerHarness): number {
  const desiredTopic = getTuningDesiredTopic(TENANT, DEVICE_ID);
  return broker.packets.filter(
    (packet) =>
      packet.topic === desiredTopic &&
      packet.retain &&
      packet.payload.length === 0,
  ).length;
}

function snapshotDurableState(
  config: DeviceTuningConfiguration,
): Readonly<Record<string, unknown>> {
  return {
    status: config.status,
    reportedConfig: structuredClone(config.reportedConfig),
    reportedRevision: config.reportedRevision,
    appliedAt: config.appliedAt?.toISOString() ?? null,
    rejectionReason: config.rejectionReason,
    retainedClearPending: config.retainedClearPending,
    retainedClearAttempts: config.retainedClearAttempts,
    retainedClearNextAt: config.retainedClearNextAt?.toISOString() ?? null,
    updatedAt: config.updatedAt.toISOString(),
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for ACK.');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
