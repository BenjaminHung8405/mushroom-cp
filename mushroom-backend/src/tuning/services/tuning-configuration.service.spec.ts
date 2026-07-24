import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InternalServerErrorException } from '@nestjs/common';
import { TuningConfigurationService, TuningSyncEvent } from './tuning-configuration.service';
import { DeviceTuningConfiguration, SyncStatus } from '../entities/device-tuning-configuration.entity';
import { TuningAuditLog } from '../entities/tuning-audit-log.entity';
import { TuningReportedEvent } from '../../mqtt/mqtt.service';

describe('TuningConfigurationService', () => {
  let service: TuningConfigurationService;
  let configRepo: jest.Mocked<Repository<DeviceTuningConfiguration>>;
  let auditRepo: jest.Mocked<Repository<TuningAuditLog>>;
  let dataSource: jest.Mocked<DataSource>;

  const mockRepository = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  });

  const mockDataSource = () => ({
    transaction: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TuningConfigurationService,
        {
          provide: getRepositoryToken(DeviceTuningConfiguration),
          useFactory: mockRepository,
        },
        {
          provide: getRepositoryToken(TuningAuditLog),
          useFactory: mockRepository,
        },
        {
          provide: DataSource,
          useFactory: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<TuningConfigurationService>(TuningConfigurationService);
    configRepo = module.get(getRepositoryToken(DeviceTuningConfiguration));
    auditRepo = module.get(getRepositoryToken(TuningAuditLog));
    dataSource = module.get(DataSource);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handleReportedAck', () => {
    const validCommandId = '12345678-1234-1234-1234-1234567890ab';
    const validDeviceId = 'device-1';

    it('should drop invalid payload (empty, null)', async () => {
      const result = await service.handleReportedAck(null as any);
      expect(result).toEqual({ updated: false, isLatest: false });
    });

    it('should drop payload with invalid deviceId', async () => {
      const result = await service.handleReportedAck({
        deviceId: '',
        commandId: validCommandId,
        status: 'ACCEPTED',
        reasonCode: null,
        persisted: true,
        receivedAt: new Date(),
      });
      expect(result).toEqual({ updated: false, isLatest: false });
    });

    it('should drop payload with malformed commandId (not UUID)', async () => {
      const result = await service.handleReportedAck({
        deviceId: validDeviceId,
        commandId: 'invalid-uuid-format',
        status: 'ACCEPTED',
        reasonCode: null,
        persisted: true,
        receivedAt: new Date(),
      });
      expect(result).toEqual({ updated: false, isLatest: false });
    });

    it('should drop payload with unknown status', async () => {
      const result = await service.handleReportedAck({
        deviceId: validDeviceId,
        commandId: validCommandId,
        status: 'INVALID_STATUS' as any,
        reasonCode: null,
        persisted: true,
        receivedAt: new Date(),
      });
      expect(result).toEqual({ updated: false, isLatest: false });
    });

    it('should handle unknown commandId (security log & fail-safe)', async () => {
      dataSource.transaction.mockImplementation(async (cb) => {
        const mockManager = {
          findOne: jest.fn().mockResolvedValue(null),
        };
        await cb(mockManager as any);
      });

      const ack: TuningReportedEvent = {
        deviceId: validDeviceId,
        commandId: validCommandId,
        status: 'ACCEPTED',
        reasonCode: null,
        persisted: true,
        receivedAt: new Date(),
      };

      const result = await service.handleReportedAck(ack);
      expect(result).toEqual({ updated: false, isLatest: false });
    });

    it('should handle deviceId mismatch (security log & fail-safe)', async () => {
      dataSource.transaction.mockImplementation(async (cb) => {
        const mockManager = {
          findOne: jest.fn().mockImplementation((entity, options) => {
            if (entity === DeviceTuningConfiguration) {
              return Promise.resolve({
                id: 'config-uuid',
                deviceId: 'different-device',
                commandId: validCommandId,
                status: SyncStatus.PENDING,
                config: { lamp_gain_scale: 1, mist_gain_scale: 1, mist_on_threshold: 0.25, mist_off_threshold: 0.15 },
              });
            }
            return Promise.resolve(null);
          }),
        };
        await cb(mockManager as any);
      });

      const ack: TuningReportedEvent = {
        deviceId: validDeviceId, // 'device-1' !== 'different-device'
        commandId: validCommandId,
        status: 'ACCEPTED',
        reasonCode: null,
        persisted: true,
        receivedAt: new Date(),
      };

      const result = await service.handleReportedAck(ack);
      expect(result).toEqual({ updated: false, isLatest: false });
    });

    it('should stay idempotent if status is already IN_SYNC', async () => {
      dataSource.transaction.mockImplementation(async (cb) => {
        const mockManager = {
          findOne: jest.fn().mockImplementation((entity, options) => {
            if (entity === DeviceTuningConfiguration) {
              // commandId match
              if (options.where.commandId === validCommandId) {
                return Promise.resolve({
                  id: 'config-uuid',
                  deviceId: validDeviceId,
                  commandId: validCommandId,
                  status: SyncStatus.IN_SYNC,
                  config: { lamp_gain_scale: 1, mist_gain_scale: 1 },
                });
              }
              // latest lookup
              return Promise.resolve({ commandId: validCommandId });
            }
            return Promise.resolve(null);
          }),
          save: jest.fn(),
        };
        await cb(mockManager as any);
      });

      const ack: TuningReportedEvent = {
        deviceId: validDeviceId,
        commandId: validCommandId,
        status: 'ACCEPTED',
        reasonCode: null,
        persisted: true,
        receivedAt: new Date(),
      };

      const result = await service.handleReportedAck(ack);
      expect(result).toEqual({ updated: false, isLatest: true });
    });

    it('should apply transition PENDING -> IN_SYNC on ACCEPTED, create audit, and emit SSE after commit', async () => {
      let emittedEvent: TuningSyncEvent | null = null;
      service.tuningSync$.subscribe((event) => {
        emittedEvent = event;
      });

      const configEntity = {
        id: 'config-uuid',
        deviceId: validDeviceId,
        commandId: validCommandId,
        revision: 2,
        status: SyncStatus.PENDING,
        config: { lamp_gain_scale: 1.2, mist_gain_scale: 0.8 },
        publishedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const prevConfigEntity = {
        id: 'prev-uuid',
        deviceId: validDeviceId,
        commandId: 'prev-command-uuid',
        revision: 1,
        status: SyncStatus.IN_SYNC,
        config: { lamp_gain_scale: 1.0, mist_gain_scale: 1.0 },
        createdAt: new Date(Date.now() - 60000),
      };

      let saveCalled = false;
      let auditCreated = false;

      dataSource.transaction.mockImplementation(async (cb) => {
        const mockManager = {
          findOne: jest.fn().mockImplementation((entity, options) => {
            if (entity === DeviceTuningConfiguration) {
              if (options.where.commandId === validCommandId) {
                return Promise.resolve(configEntity);
              }
              // latest check or prev config check
              if (options.where.status === SyncStatus.IN_SYNC) {
                return Promise.resolve(prevConfigEntity);
              }
              // latest checking (order by createdAt DESC)
              return Promise.resolve(configEntity);
            }
            return Promise.resolve(null);
          }),
          save: jest.fn().mockImplementation((entity, data) => {
            saveCalled = true;
            return Promise.resolve(data);
          }),
          create: jest.fn().mockImplementation((entity, data) => {
            if (entity === TuningAuditLog) {
              auditCreated = true;
              expect(data.configBefore).toEqual(prevConfigEntity.config);
              expect(data.configAfter).toEqual(configEntity.config);
              expect(data.action).toBe('SYNC_ACCEPTED');
              expect(data.result).toBe('SUCCESS');
            }
            return data;
          }),
        };
        await cb(mockManager as any);
      });

      const ack: TuningReportedEvent = {
        deviceId: validDeviceId,
        commandId: validCommandId,
        status: 'ACCEPTED',
        reasonCode: null,
        persisted: true,
        receivedAt: new Date(),
      };

      const result = await service.handleReportedAck(ack);
      expect(result).toEqual({ updated: true, isLatest: true });
      expect(configEntity.status).toBe(SyncStatus.IN_SYNC);
      expect(saveCalled).toBe(true);
      expect(auditCreated).toBe(true);
      expect(emittedEvent).toBeDefined();
      expect(emittedEvent!.status).toBe(SyncStatus.IN_SYNC);
    });

    it('should apply transition PENDING -> REJECTED on REJECTED, create audit, and emit SSE after commit', async () => {
      let emittedEvent: TuningSyncEvent | null = null;
      service.tuningSync$.subscribe((event) => {
        emittedEvent = event;
      });

      const configEntity = {
        id: 'config-uuid',
        deviceId: validDeviceId,
        commandId: validCommandId,
        revision: 2,
        status: SyncStatus.PENDING,
        config: { lamp_gain_scale: 1.2, mist_gain_scale: 0.8 },
        publishedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      dataSource.transaction.mockImplementation(async (cb) => {
        const mockManager = {
          findOne: jest.fn().mockImplementation((entity, options) => {
            if (entity === DeviceTuningConfiguration) {
              if (options.where.commandId === validCommandId) {
                return Promise.resolve(configEntity);
              }
              if (options.where.status === SyncStatus.IN_SYNC) {
                return Promise.resolve(null);
              }
              return Promise.resolve(configEntity); // latest check
            }
            return Promise.resolve(null);
          }),
          save: jest.fn().mockImplementation((entity, data) => Promise.resolve(data)),
          create: jest.fn().mockImplementation((entity, data) => {
            if (entity === TuningAuditLog) {
              expect(data.configBefore).toBeNull();
              expect(data.configAfter).toEqual(configEntity.config);
              expect(data.action).toBe('SYNC_REJECTED');
              expect(data.result).toBe('FAILED');
              expect(data.reason).toBe('VAL_ERR');
            }
            return data;
          }),
        };
        await cb(mockManager as any);
      });

      const ack: TuningReportedEvent = {
        deviceId: validDeviceId,
        commandId: validCommandId,
        status: 'REJECTED',
        reasonCode: 'VAL_ERR',
        persisted: true,
        receivedAt: new Date(),
      };

      const result = await service.handleReportedAck(ack);
      expect(result).toEqual({ updated: true, isLatest: true });
      expect(configEntity.status).toBe(SyncStatus.REJECTED);
      expect(emittedEvent).toBeDefined();
      expect(emittedEvent!.status).toBe(SyncStatus.REJECTED);
    });

    it('should throw InternalServerErrorException when database error occurs', async () => {
      dataSource.transaction.mockRejectedValue(new Error('DB failure'));

      const ack: TuningReportedEvent = {
        deviceId: validDeviceId,
        commandId: validCommandId,
        status: 'ACCEPTED',
        reasonCode: null,
        persisted: true,
        receivedAt: new Date(),
      };

      await expect(service.handleReportedAck(ack)).rejects.toThrow(
        InternalServerErrorException
      );
    });
  });
});
