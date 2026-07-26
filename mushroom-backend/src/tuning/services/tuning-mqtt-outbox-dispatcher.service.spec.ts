import { DataSource, Repository } from 'typeorm';
import { MqttService } from '../../mqtt/mqtt.service';
import {
  DeviceTuningConfiguration,
  SyncStatus,
  TuningConfigSnapshot,
} from '../entities/device-tuning-configuration.entity';
import {
  TuningMqttOutbox,
  TuningMqttOutboxAction,
} from '../entities/tuning-mqtt-outbox.entity';
import { TuningMqttOutboxDispatcher } from './tuning-mqtt-outbox-dispatcher.service';

const snapshot: TuningConfigSnapshot = {
  lamp_gain_scale: 1,
  mist_gain_scale: 1,
  mist_on_threshold: 0.25,
  mist_off_threshold: 0.15,
};

const outbox = (
  overrides: Partial<TuningMqttOutbox> = {},
): TuningMqttOutbox => ({
  id: 'outbox-1',
  deviceId: 'device-1',
  configurationId: 'config-1',
  action: TuningMqttOutboxAction.PUBLISH_DESIRED,
  revision: 1,
  payload: snapshot,
  attempts: 0,
  nextAttemptAt: new Date(0),
  deliveredAt: null,
  processingAt: null,
  leaseExpiresAt: null,
  workerId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

const config = (
  overrides: Partial<DeviceTuningConfiguration> = {},
): DeviceTuningConfiguration => ({
  id: 'config-1',
  deviceId: 'device-1',
  commandId: '12345678-1234-1234-1234-1234567890ab',
  revision: 1,
  status: SyncStatus.PENDING,
  config: snapshot,
  reportedConfig: null,
  reportedRevision: null,
  appliedAt: null,
  rejectionReason: null,
  publishedAt: null,
  retainedClearPending: false,
  retainedClearAttempts: 0,
  retainedClearNextAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});

describe('TuningMqttOutboxDispatcher', () => {
  type TransactionCallback = (manager: unknown) => Promise<unknown>;
  let dataSource: {
    transaction: jest.Mock<Promise<unknown>, [TransactionCallback]>;
  };
  let repo: jest.Mocked<Pick<Repository<TuningMqttOutbox>, 'find'>>;
  let mqtt: { publishTuningDesired: jest.Mock; clearTuningDesired: jest.Mock };
  let dispatcher: TuningMqttOutboxDispatcher;

  beforeEach(() => {
    dataSource = {
      transaction: jest.fn<Promise<unknown>, [TransactionCallback]>(),
    };
    repo = { find: jest.fn() };
    mqtt = { publishTuningDesired: jest.fn(), clearTuningDesired: jest.fn() };
    dispatcher = new TuningMqttOutboxDispatcher(
      dataSource as unknown as DataSource,
      repo as unknown as Repository<TuningMqttOutbox>,
      mqtt as unknown as MqttService,
    );
  });

  it('publishes only after the short claim transaction has committed', async () => {
    const item = outbox();
    const pending = config();
    let activeTransactions = 0;
    const claimManager = managerFor(item, pending, pending);
    const finalizeManager = managerFor(item, pending, pending);
    dataSource.transaction
      .mockImplementationOnce(async (callback: TransactionCallback) => {
        activeTransactions += 1;
        const result = await callback(claimManager);
        activeTransactions -= 1;
        return result;
      })
      .mockImplementationOnce(async (callback: TransactionCallback) => {
        activeTransactions += 1;
        const result = await callback(finalizeManager);
        activeTransactions -= 1;
        return result;
      });
    mqtt.publishTuningDesired.mockImplementation(() => {
      expect(activeTransactions).toBe(0);
      return Promise.resolve();
    });

    await dispatch(dispatcher, item.id);

    expect(mqtt.publishTuningDesired).toHaveBeenCalledWith(
      pending.deviceId,
      pending.commandId,
      pending.revision,
      snapshot,
    );
    expect(item.deliveredAt).toEqual(expect.any(Date));
    expect(item.workerId).toBeNull();
  });

  it('keeps the item retryable if the post-publish finalize transaction fails', async () => {
    const item = outbox();
    const pending = config();
    const claimManager = managerFor(item, pending, pending);
    const retryManager = {
      findOne: jest.fn().mockResolvedValue(item),
      save: jest.fn(),
    };
    dataSource.transaction
      .mockImplementationOnce((callback: TransactionCallback) =>
        callback(claimManager),
      )
      .mockRejectedValueOnce(new Error('commit failed after MQTT publish'))
      .mockImplementationOnce((callback: TransactionCallback) =>
        callback(retryManager),
      );

    await dispatch(dispatcher, item.id);

    expect(mqtt.publishTuningDesired).toHaveBeenCalledTimes(1);
    expect(item.deliveredAt).toBeNull();
    expect(item.attempts).toBe(1);
    expect(item.workerId).toBeNull();
    expect(retryManager.save).toHaveBeenCalledWith(TuningMqttOutbox, item);
  });

  it('allows only one replica to claim an item while its durable lease is live', async () => {
    const item = outbox({
      leaseExpiresAt: new Date(Date.now() + 30_000),
      workerId: '12345678-1234-1234-1234-1234567890ab',
    });
    const manager = { findOne: jest.fn().mockResolvedValue(item) };
    dataSource.transaction.mockImplementation((callback: TransactionCallback) =>
      callback(manager),
    );

    await dispatch(dispatcher, item.id);

    expect(mqtt.publishTuningDesired).not.toHaveBeenCalled();
    expect(manager.findOne).toHaveBeenCalledTimes(1);
  });

  it('fences a stale retained clear before broker I/O when a newer desired exists', async () => {
    const clear = outbox({ action: TuningMqttOutboxAction.CLEAR_RETAINED });
    const stale = config({
      status: SyncStatus.IN_SYNC,
      retainedClearPending: true,
    });
    const newer = config({
      id: 'config-2',
      revision: 2,
      status: SyncStatus.PENDING,
    });
    const manager = managerFor(clear, stale, newer);
    dataSource.transaction.mockImplementation((callback: TransactionCallback) =>
      callback(manager),
    );

    await dispatch(dispatcher, clear.id);

    expect(mqtt.clearTuningDesired).not.toHaveBeenCalled();
    expect(clear.deliveredAt).toEqual(expect.any(Date));
    expect(clear.workerId).toBeNull();
  });

  function managerFor(
    item: TuningMqttOutbox,
    current: DeviceTuningConfiguration,
    latest: DeviceTuningConfiguration,
  ) {
    return {
      query: jest.fn().mockResolvedValue([]),
      findOne: jest
        .fn()
        .mockResolvedValueOnce(item)
        .mockResolvedValueOnce(current)
        .mockResolvedValueOnce(latest),
      save: jest.fn(),
    };
  }
});

function dispatch(
  dispatcher: TuningMqttOutboxDispatcher,
  outboxId: string,
): Promise<void> {
  return (
    dispatcher as unknown as { dispatchOne(id: string): Promise<void> }
  ).dispatchOne(outboxId);
}
