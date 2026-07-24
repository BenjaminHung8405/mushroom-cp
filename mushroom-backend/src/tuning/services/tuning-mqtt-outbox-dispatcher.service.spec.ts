import { DataSource, Repository } from 'typeorm';
import { MqttService } from '../../mqtt/mqtt.service';
import { DeviceTuningConfiguration, SyncStatus, TuningConfigSnapshot } from '../entities/device-tuning-configuration.entity';
import { TuningMqttOutbox, TuningMqttOutboxAction } from '../entities/tuning-mqtt-outbox.entity';
import { TuningMqttOutboxDispatcher } from './tuning-mqtt-outbox-dispatcher.service';

const snapshot: TuningConfigSnapshot = {
  lamp_gain_scale: 1,
  mist_gain_scale: 1,
  mist_on_threshold: 0.25,
  mist_off_threshold: 0.15,
};

const outbox = (overrides: Partial<TuningMqttOutbox> = {}): TuningMqttOutbox => ({
  id: 'outbox-1', deviceId: 'device-1', configurationId: 'config-1',
  action: TuningMqttOutboxAction.PUBLISH_DESIRED, revision: 1, payload: snapshot,
  attempts: 0, nextAttemptAt: new Date(0), deliveredAt: null,
  createdAt: new Date(0), updatedAt: new Date(0), ...overrides,
});

const config = (overrides: Partial<DeviceTuningConfiguration> = {}): DeviceTuningConfiguration => ({
  id: 'config-1', deviceId: 'device-1', commandId: '12345678-1234-1234-1234-1234567890ab',
  revision: 1, status: SyncStatus.PENDING, config: snapshot, publishedAt: null,
  retainedClearPending: false, retainedClearAttempts: 0, retainedClearNextAt: null,
  createdAt: new Date(0), updatedAt: new Date(0), ...overrides,
});

describe('TuningMqttOutboxDispatcher', () => {
  let dataSource: { transaction: jest.Mock };
  let repo: jest.Mocked<Pick<Repository<TuningMqttOutbox>, 'find'>>;
  let mqtt: { publishTuningDesired: jest.Mock; clearTuningDesired: jest.Mock };
  let dispatcher: TuningMqttOutboxDispatcher;

  beforeEach(() => {
    dataSource = { transaction: jest.fn() };
    repo = { find: jest.fn() };
    mqtt = { publishTuningDesired: jest.fn(), clearTuningDesired: jest.fn() };
    dispatcher = new TuningMqttOutboxDispatcher(dataSource as unknown as DataSource, repo as unknown as Repository<TuningMqttOutbox>, mqtt as unknown as MqttService);
  });

  it('fences a stale retained clear after a newer revision exists', async () => {
    const clear = outbox({ action: TuningMqttOutboxAction.CLEAR_RETAINED });
    const stale = config({ status: SyncStatus.IN_SYNC, retainedClearPending: true });
    const newer = config({ id: 'config-2', revision: 2, status: SyncStatus.PENDING });
    const manager = {
      query: jest.fn(),
      findOne: jest.fn().mockResolvedValueOnce(clear).mockResolvedValueOnce(clear).mockResolvedValueOnce(stale).mockResolvedValueOnce(newer),
      save: jest.fn(),
    };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager));

    await (dispatcher as unknown as { dispatchOne(id: string): Promise<void> }).dispatchOne(clear.id);

    expect(mqtt.clearTuningDesired).not.toHaveBeenCalled();
    expect(manager.save).toHaveBeenCalledWith(TuningMqttOutbox, expect.objectContaining({ deliveredAt: expect.any(Date) }));
  });

  it('publishes durable desired items in revision order, preventing an older retained desired from winning', async () => {
    const oldItem = outbox({ id: 'old', revision: 1 });
    const newItem = outbox({ id: 'new', configurationId: 'config-2', revision: 2, payload: { ...snapshot, lamp_gain_scale: 1.1 } });
    repo.find.mockResolvedValue([oldItem, newItem]);
    const dispatchOne = jest.spyOn(dispatcher as unknown as { dispatchOne(id: string): Promise<void> }, 'dispatchOne').mockResolvedValue();

    await dispatcher.dispatchDue();

    expect(dispatchOne).toHaveBeenNthCalledWith(1, 'old');
    expect(dispatchOne).toHaveBeenNthCalledWith(2, 'new');
  });

  it('keeps a PENDING command retryable when the DB delivery write fails after MQTT succeeds', async () => {
    const item = outbox();
    const pending = config();
    const manager = {
      query: jest.fn(),
      findOne: jest.fn().mockResolvedValueOnce(item).mockResolvedValueOnce(pending).mockResolvedValueOnce(pending),
      save: jest.fn().mockRejectedValueOnce(new Error('database write failed')),
    };
    const retryItem = outbox();
    const retryManager = { findOne: jest.fn().mockResolvedValue(retryItem), save: jest.fn() };
    dataSource.transaction
      .mockImplementationOnce(async (callback) => callback(manager))
      .mockImplementationOnce(async (callback) => callback(retryManager));

    await (dispatcher as unknown as { dispatchOne(id: string): Promise<void> }).dispatchOne(item.id);

    expect(mqtt.publishTuningDesired).toHaveBeenCalledWith(pending.deviceId, pending.commandId, pending.revision, snapshot);
    expect(pending.status).toBe(SyncStatus.PENDING);
    expect(retryItem.attempts).toBe(1);
    expect(retryManager.save).toHaveBeenCalledWith(TuningMqttOutbox, retryItem);
  });

  it('continues retrying after more than five broker outages and delivers after recovery', async () => {
    const item = outbox({ action: TuningMqttOutboxAction.CLEAR_RETAINED, attempts: 5 });
    const synced = config({ status: SyncStatus.IN_SYNC, retainedClearPending: true });
    const failedManager = {
      query: jest.fn(),
      findOne: jest.fn().mockResolvedValueOnce(item).mockResolvedValueOnce(synced).mockResolvedValueOnce(synced),
      save: jest.fn(),
    };
    const retryManager = {
      findOne: jest.fn().mockImplementation(async () => item),
      save: jest.fn().mockImplementation(async (_entity: unknown, value: unknown) => value),
    };
    mqtt.clearTuningDesired.mockRejectedValueOnce(new Error('broker unavailable'));
    dataSource.transaction
      .mockImplementationOnce(async (callback) => callback(failedManager))
      .mockImplementationOnce(async (callback) => callback(retryManager));

    await (dispatcher as unknown as { dispatchOne(id: string): Promise<void> }).dispatchOne(item.id);
    expect(item.attempts).toBe(6);

    item.nextAttemptAt = new Date(0);
    const recoveredManager = {
      query: jest.fn(),
      findOne: jest.fn().mockResolvedValueOnce(item).mockResolvedValueOnce(synced).mockResolvedValueOnce(synced),
      save: jest.fn(),
    };
    dataSource.transaction.mockImplementationOnce(async (callback) => callback(recoveredManager));
    await (dispatcher as unknown as { dispatchOne(id: string): Promise<void> }).dispatchOne(item.id);

    expect(mqtt.clearTuningDesired).toHaveBeenCalledTimes(2);
    expect(item.deliveredAt).toEqual(expect.any(Date));
  });
});
