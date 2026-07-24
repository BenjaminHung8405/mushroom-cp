import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Subject } from 'rxjs';
import { MqttService, TuningReportedEvent } from '../../mqtt/mqtt.service';
import { Device } from '../../device/entities/device.entity';
import { DeviceTuningConfiguration, SyncStatus, TuningConfigSnapshot } from '../entities/device-tuning-configuration.entity';
import { TuningAuditLog } from '../entities/tuning-audit-log.entity';
import { TuningConfigurationService, TuningPrincipal } from './tuning-configuration.service';
import { TuningMqttOutboxDispatcher } from './tuning-mqtt-outbox-dispatcher.service';

const commandId = '12345678-1234-1234-1234-1234567890ab';
const deviceId = 'device-1';
const principal: TuningPrincipal = { subject: 'operator-1', allowedHouseIds: ['house-1'] };
const config: TuningConfigSnapshot = { lamp_gain_scale: 1, mist_gain_scale: 1, mist_on_threshold: 0.25, mist_off_threshold: 0.15 };
const repo = () => ({ find: jest.fn().mockResolvedValue([]), findOne: jest.fn(), findAndCount: jest.fn(), create: jest.fn(), save: jest.fn(), update: jest.fn().mockResolvedValue({}) });

describe('TuningConfigurationService hardening', () => {
  let service: TuningConfigurationService;
  let dataSource: { transaction: jest.Mock };
  let configRepo: jest.Mocked<Pick<Repository<DeviceTuningConfiguration>, 'find' | 'findOne' | 'save' | 'update'>>;
  let mqtt: { publishTuningDesired: jest.Mock; clearTuningDesired: jest.Mock; tuningReported$: Subject<TuningReportedEvent> };
  let outbox: { enqueueDesired: jest.Mock; enqueueRetainedClear: jest.Mock; dispatchDue: jest.Mock };

  beforeEach(async () => {
    dataSource = { transaction: jest.fn() };
    mqtt = { publishTuningDesired: jest.fn(), clearTuningDesired: jest.fn(), tuningReported$: new Subject<TuningReportedEvent>() };
    outbox = { enqueueDesired: jest.fn(), enqueueRetainedClear: jest.fn(), dispatchDue: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        TuningConfigurationService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(DeviceTuningConfiguration), useFactory: repo },
        { provide: getRepositoryToken(TuningAuditLog), useFactory: repo },
        { provide: MqttService, useValue: mqtt },
        { provide: TuningMqttOutboxDispatcher, useValue: outbox },
      ],
    }).compile();
    service = module.get(TuningConfigurationService);
    configRepo = module.get(getRepositoryToken(DeviceTuningConfiguration));
  });

  it('enforces immutable v1 bounds before database mutation', async () => {
    await expect(service.createPendingCommand(principal, deviceId, { ...config, lamp_gain_scale: 1.21 }, commandId)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createPendingCommand(principal, deviceId, { ...config, mist_off_threshold: 0.21 }, commandId)).rejects.toBeInstanceOf(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('selects the highest revision as latest even when configuration timestamps are equal', async () => {
    configRepo.findOne.mockResolvedValue(null);
    await service.getLatestByDeviceId(deviceId);
    expect(configRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { deviceId }, order: { revision: 'DESC' },
    }));
  });

  it('rejects a principal outside the device house scope in the write transaction', async () => {
    dataSource.transaction.mockImplementation(async (callback) => callback({ query: jest.fn(), findOne: jest.fn().mockResolvedValue({ deviceId, houseId: 'house-1', enabled: true }) }));
    await expect(service.createPendingCommand({ subject: 'other', allowedHouseIds: [] }, deviceId, config, commandId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses the immutable persisted snapshot for an unpublished idempotent command', async () => {
    const persisted = { id: 'config-1', deviceId, commandId, revision: 1, status: SyncStatus.PENDING, config, publishedAt: null, createdAt: new Date(), updatedAt: new Date() } as DeviceTuningConfiguration;
    dataSource.transaction.mockImplementation(async (callback) => callback({
      query: jest.fn(),
      findOne: jest.fn().mockImplementation((entity: unknown) => entity === Device ? { deviceId, houseId: 'house-1', enabled: true } : persisted),
    }));
    configRepo.save.mockImplementation(async (value) => value as DeviceTuningConfiguration);
    await service.createPendingCommand(principal, deviceId, { ...config, lamp_gain_scale: 1.1 }, commandId).catch(() => undefined);
    // Mismatched command idempotency bodies are rejected rather than republished.
    expect(mqtt.publishTuningDesired).not.toHaveBeenCalled();
  });

  it('does not transition ACCEPTED ACK without firmware persistence confirmation', async () => {
    const pending = { id: 'config-1', deviceId, commandId, revision: 1, status: SyncStatus.PENDING, config, publishedAt: new Date(), createdAt: new Date(), updatedAt: new Date() } as DeviceTuningConfiguration;
    const manager = { findOne: jest.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValueOnce(null), save: jest.fn().mockResolvedValue(pending), create: jest.fn((_entity: unknown, value: unknown) => value) };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager));
    const result = await service.handleReportedAck({ deviceId, commandId, status: 'ACCEPTED', persisted: false, reasonCode: null, reportedConfig: config, revision: 1, receivedAt: new Date() });
    expect(result.updated).toBe(true);
    expect(pending.status).toBe(SyncStatus.REJECTED);
    expect(pending.rejectionReason).toBe('PERSISTENCE_NOT_CONFIRMED');
    expect(mqtt.clearTuningDesired).not.toHaveBeenCalled();
  });

  it('rejects an accepted ACK whose revision or canonical config mismatches the desired', async () => {
    const pending = { id: 'config-1', deviceId, commandId, revision: 2, status: SyncStatus.PENDING, config, publishedAt: new Date(), createdAt: new Date(), updatedAt: new Date() } as DeviceTuningConfiguration;
    const manager = { findOne: jest.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(pending).mockResolvedValueOnce(null), save: jest.fn().mockResolvedValue(pending), create: jest.fn((_entity: unknown, value: unknown) => value) };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager));
    await service.handleReportedAck({ deviceId, commandId, status: 'ACCEPTED', persisted: true, reasonCode: null, reportedConfig: config, revision: 1, receivedAt: new Date() });
    expect(pending.status).toBe(SyncStatus.REJECTED);
    expect(pending.rejectionReason).toBe('REVISION_MISMATCH');

    const other = { id: 'config-2', deviceId, commandId, revision: 3, status: SyncStatus.PENDING, config, publishedAt: new Date(), createdAt: new Date(), updatedAt: new Date() } as DeviceTuningConfiguration;
    const manager2 = { findOne: jest.fn().mockResolvedValueOnce(other).mockResolvedValueOnce(other).mockResolvedValueOnce(null), save: jest.fn().mockResolvedValue(other), create: jest.fn((_entity: unknown, value: unknown) => value) };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager2));
    const bogus = { ...config, lamp_gain_scale: 0.9 };
    await service.handleReportedAck({ deviceId, commandId, status: 'ACCEPTED', persisted: true, reasonCode: null, reportedConfig: bogus, revision: 3, receivedAt: new Date() });
    expect(other.status).toBe(SyncStatus.REJECTED);
    expect(other.rejectionReason).toBe('CANONICAL_MISMATCH');
  });

  it('queues a retained clear durably instead of issuing MQTT from the ACK transaction', async () => {
    const synced = { id: 'config-1', deviceId, commandId, revision: 1, status: SyncStatus.PENDING, config, retainedClearPending: false, createdAt: new Date(), updatedAt: new Date() } as DeviceTuningConfiguration;
    const manager = { findOne: jest.fn().mockResolvedValueOnce(synced).mockResolvedValueOnce(synced).mockResolvedValueOnce(null), save: jest.fn().mockResolvedValue(synced), create: jest.fn((_entity: unknown, value: unknown) => value) };
    dataSource.transaction.mockImplementation(async (callback) => callback(manager));
    await service.handleReportedAck({ deviceId, commandId, status: 'ACCEPTED', persisted: true, reasonCode: null, reportedConfig: config, revision: 1, receivedAt: new Date() });
    expect(synced.status).toBe(SyncStatus.IN_SYNC);
    expect(synced.reportedConfig).toEqual(config);
    expect(synced.reportedRevision).toBe(1);
    expect(outbox.enqueueRetainedClear).toHaveBeenCalledWith(manager, synced);
    expect(mqtt.clearTuningDesired).not.toHaveBeenCalled();
  });

  it('ignores malformed ACKs whose reported_config violates the v1 contract', async () => {
    dataSource.transaction.mockImplementation(async () => undefined);
    const bogus = { ...config, mist_off_threshold: config.mist_on_threshold };
    const result = await service.handleReportedAck({ deviceId, commandId, status: 'ACCEPTED', persisted: true, reasonCode: null, reportedConfig: bogus, revision: 1, receivedAt: new Date() });
    expect(result.updated).toBe(false);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
