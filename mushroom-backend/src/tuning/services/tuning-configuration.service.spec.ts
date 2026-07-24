import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Subject } from 'rxjs';
import { TuningConfigurationService, TuningSyncEvent } from './tuning-configuration.service';
import { DeviceTuningConfiguration, SyncStatus } from '../entities/device-tuning-configuration.entity';
import { TuningAuditLog } from '../entities/tuning-audit-log.entity';
import { TuningReportedEvent, MqttService } from '../../mqtt/mqtt.service';
import { Device } from '../../device/entities/device.entity';

describe('TuningConfigurationService', () => {
  let service: TuningConfigurationService;
  let configRepo: jest.Mocked<Repository<DeviceTuningConfiguration>>;
  let auditRepo: jest.Mocked<Repository<TuningAuditLog>>;
  let deviceRepo: jest.Mocked<Repository<Device>>;
  let dataSource: jest.Mocked<DataSource>;
  let mqttService: jest.Mocked<MqttService>;

  const mockRepository = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findAndCount: jest.fn(),
  });

  const mockDataSource = () => ({
    transaction: jest.fn(),
  });

  const mockMqttService = () => ({
    publishTuningDesired: jest.fn(),
    clearTuningDesired: jest.fn().mockResolvedValue(undefined),
    tuningReported$: new Subject<TuningReportedEvent>(),
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
          provide: getRepositoryToken(Device),
          useFactory: mockRepository,
        },
        {
          provide: DataSource,
          useFactory: mockDataSource,
        },
        {
          provide: MqttService,
          useFactory: mockMqttService,
        },
      ],
    }).compile();

    service = module.get<TuningConfigurationService>(TuningConfigurationService);
    configRepo = module.get(getRepositoryToken(DeviceTuningConfiguration));
    auditRepo = module.get(getRepositoryToken(TuningAuditLog));
    deviceRepo = module.get(getRepositoryToken(Device));
    dataSource = module.get(DataSource);
    mqttService = module.get(MqttService);
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

    it('should clear retained desired topic when latest pending ACK arrives', async () => {
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
              if (options.where.commandId === validCommandId) return Promise.resolve(configEntity);
              return Promise.resolve({ commandId: validCommandId }); // isLatest: true
            }
            return Promise.resolve(null);
          }),
          save: jest.fn(),
          create: jest.fn().mockReturnValue({}),
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
      expect(mqttService.clearTuningDesired).toHaveBeenCalledWith(validDeviceId);
    });

    it('should not clear retained desired when old ACK arrives after new command', async () => {
      const oldCommandId = '11111111-1111-1111-1111-111111111111';
      const newCommandId = '22222222-2222-2222-2222-222222222222';
      const configEntity = {
        id: 'config-uuid',
        deviceId: validDeviceId,
        commandId: oldCommandId,
        revision: 1,
        status: SyncStatus.PENDING,
        config: { lamp_gain_scale: 1.0, mist_gain_scale: 1.0 },
        publishedAt: new Date(),
        createdAt: new Date(Date.now() - 5000),
        updatedAt: new Date(),
      };

      dataSource.transaction.mockImplementation(async (cb) => {
        const mockManager = {
          findOne: jest.fn().mockImplementation((entity, options) => {
            if (entity === DeviceTuningConfiguration) {
              if (options.where.commandId === oldCommandId) return Promise.resolve(configEntity);
              // latest command is newCommandId
              return Promise.resolve({ commandId: newCommandId });
            }
            return Promise.resolve(null);
          }),
          save: jest.fn(),
          create: jest.fn().mockReturnValue({}),
        };
        await cb(mockManager as any);
      });

      const ack: TuningReportedEvent = {
        deviceId: validDeviceId,
        commandId: oldCommandId,
        status: 'ACCEPTED',
        reasonCode: null,
        persisted: true,
        receivedAt: new Date(),
      };

      const result = await service.handleReportedAck(ack);
      expect(result).toEqual({ updated: true, isLatest: false });
      expect(mqttService.clearTuningDesired).not.toHaveBeenCalled();
    });

    it('should not clear retained desired on duplicate ACK', async () => {
      dataSource.transaction.mockImplementation(async (cb) => {
        const mockManager = {
          findOne: jest.fn().mockImplementation((entity, options) => {
            if (entity === DeviceTuningConfiguration) {
              if (options.where.commandId === validCommandId) {
                return Promise.resolve({
                  id: 'config-uuid',
                  deviceId: validDeviceId,
                  commandId: validCommandId,
                  status: SyncStatus.IN_SYNC,
                  config: { lamp_gain_scale: 1 },
                });
              }
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
      expect(mqttService.clearTuningDesired).not.toHaveBeenCalled();
    });

    it('should automatically route tuningReported$ events to handleReportedAck on module init', async () => {
      const handleSpy = jest.spyOn(service, 'handleReportedAck').mockResolvedValue({ updated: true, isLatest: true });
      service.onModuleInit();

      const ack: TuningReportedEvent = {
        deviceId: validDeviceId,
        commandId: validCommandId,
        status: 'ACCEPTED',
        reasonCode: null,
        persisted: true,
        receivedAt: new Date(),
      };

      (mqttService as any).tuningReported$.next(ack);
      expect(handleSpy).toHaveBeenCalledWith(ack);
      service.onModuleDestroy();
    });
  });

  describe('createPendingCommand', () => {
    const validCommandId = '12345678-1234-1234-1234-1234567890ab';
    const validDeviceId = 'device-1';
    const validActor = 'admin-user';
    const validConfig = {
      lamp_gain_scale: 1.5,
      mist_gain_scale: 2.0,
      mist_on_threshold: 0.35,
      mist_off_threshold: 0.25,
    };

    it('should throw BadRequestException if actor is missing or invalid', async () => {
      await expect(service.createPendingCommand('', validDeviceId, validConfig, validCommandId)).rejects.toThrow(
        'Actor is required'
      );
    });

    it('should throw BadRequestException if deviceId is missing or invalid', async () => {
      await expect(service.createPendingCommand(validActor, '', validConfig, validCommandId)).rejects.toThrow(
        'deviceId is required'
      );
    });

    it('should throw BadRequestException if commandId is not UUID', async () => {
      await expect(service.createPendingCommand(validActor, validDeviceId, validConfig, 'not-a-uuid')).rejects.toThrow(
        'commandId must be a valid UUID v4'
      );
    });

    it('should throw BadRequestException if config bounds are violated', async () => {
      // lamp_gain_scale > 5.0
      await expect(
        service.createPendingCommand(validActor, validDeviceId, { ...validConfig, lamp_gain_scale: 6.0 }, validCommandId)
      ).rejects.toThrow('lamp_gain_scale must be between 0.0 and 5.0');

      // mist_off_threshold >= mist_on_threshold
      await expect(
        service.createPendingCommand(validActor, validDeviceId, { ...validConfig, mist_off_threshold: 0.4 }, validCommandId)
      ).rejects.toThrow('mist_off_threshold must be strictly less than mist_on_threshold');
    });

    it('should throw NotFoundException if device does not exist', async () => {
      dataSource.transaction.mockImplementation(async (cb) => {
        const mockManager = {
          findOne: jest.fn().mockResolvedValue(null), // device find returns null
        };
        return cb(mockManager as any);
      });

      await expect(service.createPendingCommand(validActor, validDeviceId, validConfig, validCommandId)).rejects.toThrow(
        NotFoundException
      );
    });

    it('should throw BadRequestException if device is disabled', async () => {
      dataSource.transaction.mockImplementation(async (cb) => {
        const mockManager = {
          findOne: jest.fn().mockImplementation((entity) => {
            if (entity === Device) {
              return Promise.resolve({ deviceId: validDeviceId, enabled: false });
            }
            return Promise.resolve(null);
          }),
        };
        return cb(mockManager as any);
      });

      await expect(service.createPendingCommand(validActor, validDeviceId, validConfig, validCommandId)).rejects.toThrow(
        'is disabled'
      );
    });

    it('should return existing config directly if commandId already exists (idempotency)', async () => {
      const existingConfig = {
        id: 'existing-uuid',
        deviceId: validDeviceId,
        commandId: validCommandId,
        revision: 3,
        status: SyncStatus.PENDING,
        config: validConfig,
        publishedAt: new Date(),
      };

      dataSource.transaction.mockImplementation(async (cb) => {
        const mockManager = {
          findOne: jest.fn().mockImplementation((entity, options) => {
            if (entity === Device) {
              return Promise.resolve({ deviceId: validDeviceId, enabled: true });
            }
            if (entity === DeviceTuningConfiguration) {
              return Promise.resolve(existingConfig);
            }
            return Promise.resolve(null);
          }),
        };
        return cb(mockManager as any);
      });

      const result = await service.createPendingCommand(validActor, validDeviceId, validConfig, validCommandId);
      expect(result).toEqual(existingConfig);
      expect(mqttService.publishTuningDesired).not.toHaveBeenCalled();
    });

    it('should create pending config, publish MQTT, update publish time, and emit SSE', async () => {
      const savedConfigEntity = {
        id: 'new-config-uuid',
        deviceId: validDeviceId,
        commandId: validCommandId,
        revision: 4,
        status: SyncStatus.PENDING,
        config: validConfig,
        publishedAt: null as Date | null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mqttService.publishTuningDesired.mockResolvedValue(undefined);
      configRepo.save.mockImplementation((data) => Promise.resolve(data as any));

      let emittedEvent: TuningSyncEvent | null = null;
      service.tuningSync$.subscribe((event) => {
        emittedEvent = event;
      });

      // Mock the save of transaction to return savedConfigEntity
      dataSource.transaction.mockImplementation(async (cb) => {
        const mockManager = {
          findOne: jest.fn().mockImplementation((entity, options) => {
            if (entity === Device) {
              return Promise.resolve({ deviceId: validDeviceId, enabled: true });
            }
            if (entity === DeviceTuningConfiguration) {
              if (options.where.commandId === validCommandId) return Promise.resolve(null);
              if (options.where.status === SyncStatus.IN_SYNC) return Promise.resolve(null);
              return Promise.resolve({ revision: 3 });
            }
            return Promise.resolve(null);
          }),
          create: jest.fn().mockImplementation((entity, data) => data),
          save: jest.fn().mockImplementation((entity, data) => {
            if (entity === DeviceTuningConfiguration) {
              return Promise.resolve(savedConfigEntity);
            }
            return Promise.resolve(data);
          }),
        };
        return cb(mockManager as any);
      });

      const result = await service.createPendingCommand(validActor, validDeviceId, validConfig, validCommandId);

      expect(mqttService.publishTuningDesired).toHaveBeenCalledWith(validDeviceId, validCommandId, validConfig);
      expect(result.publishedAt).toBeInstanceOf(Date);
      expect(configRepo.save).toHaveBeenCalled();
      expect(emittedEvent).toBeDefined();
      expect(emittedEvent!.commandId).toBe(validCommandId);
    });

    it('should rollback to REJECTED and log audit failure if MQTT publish throws error', async () => {
      const savedConfigEntity = {
        id: 'new-config-uuid',
        deviceId: validDeviceId,
        commandId: validCommandId,
        revision: 4,
        status: SyncStatus.PENDING,
        config: validConfig,
        publishedAt: null as Date | null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mqttService.publishTuningDesired.mockRejectedValue(new Error('MQTT network failure'));

      let savedFailStatus = false;
      let createdFailAudit = false;

      // Let's adjust transaction mock to handle consecutive calls differently
      let callCount = 0;
      dataSource.transaction.mockImplementation(async (cb) => {
        callCount++;
        if (callCount === 1) {
          const mockManager = {
            findOne: jest.fn().mockImplementation((entity, options) => {
              if (entity === Device) return Promise.resolve({ deviceId: validDeviceId, enabled: true });
              if (entity === DeviceTuningConfiguration) return Promise.resolve(null);
              return Promise.resolve(null);
            }),
            create: jest.fn().mockImplementation((entity, data) => data),
            save: jest.fn().mockImplementation((entity, data) => {
              if (entity === DeviceTuningConfiguration) {
                return Promise.resolve(savedConfigEntity);
              }
              return Promise.resolve(data);
            }),
          };
          return cb(mockManager as any);
        } else {
          const mockManager = {
            update: jest.fn().mockImplementation((entity, criteria, partialEntity) => {
              if (entity === DeviceTuningConfiguration && partialEntity.status === SyncStatus.REJECTED) {
                savedFailStatus = true;
              }
              return Promise.resolve({} as any);
            }),
            create: jest.fn().mockImplementation((entity, data) => {
              if (entity === TuningAuditLog) {
                createdFailAudit = true;
                expect(data.action).toBe('PUBLISH_FAILED');
                expect(data.result).toBe('FAILED');
              }
              return data;
            }),
            save: jest.fn().mockImplementation((entity, data) => Promise.resolve(data)),
          };
          return cb(mockManager as any);
        }
      });

      await expect(
        service.createPendingCommand(validActor, validDeviceId, validConfig, validCommandId)
      ).rejects.toThrow(InternalServerErrorException);

      expect(savedFailStatus).toBe(true);
      expect(createdFailAudit).toBe(true);
      expect(savedConfigEntity.status).toBe(SyncStatus.REJECTED);
    });
  });

  describe('getLatestByDeviceId', () => {
    it('should throw BadRequestException if deviceId is invalid', async () => {
      await expect(service.getLatestByDeviceId('')).rejects.toThrow('deviceId is required');
      await expect(service.getLatestByDeviceId('a'.repeat(51))).rejects.toThrow('deviceId is required');
    });

    it('should query repository with ORDER BY createdAt DESC', async () => {
      const mockConfig = {
        id: 'config-1',
        deviceId: 'device-1',
        commandId: '12345678-1234-1234-1234-1234567890ab',
        revision: 1,
        status: SyncStatus.IN_SYNC,
        config: { lamp_gain_scale: 1, mist_gain_scale: 1, mist_on_threshold: 0.25, mist_off_threshold: 0.15 },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      configRepo.findOne.mockResolvedValue(mockConfig as any);

      const result = await service.getLatestByDeviceId('device-1');

      expect(configRepo.findOne).toHaveBeenCalledWith({
        where: { deviceId: 'device-1' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual(mockConfig);
    });

    it('should return null when no config exists for deviceId', async () => {
      configRepo.findOne.mockResolvedValue(null);

      const result = await service.getLatestByDeviceId('unknown-device');

      expect(result).toBeNull();
    });
  });

  describe('getTuningHistory', () => {
    it('should throw BadRequestException if deviceId is invalid', async () => {
      await expect(service.getTuningHistory('')).rejects.toThrow('deviceId is required');
      await expect(service.getTuningHistory('   ')).rejects.toThrow('deviceId is required');
      await expect(service.getTuningHistory('a'.repeat(51))).rejects.toThrow('deviceId is required');
    });

    it('should use default limit 20 and offset 0 when not provided', async () => {
      const mockItems = [
        {
          id: 'audit-1',
          deviceId: 'device-1',
          action: 'SYNC_ACCEPTED',
          result: 'SUCCESS',
          createdAt: new Date(),
        },
      ];
      auditRepo.findAndCount.mockResolvedValue([mockItems as any, 1]);

      const result = await service.getTuningHistory('device-1');

      expect(auditRepo.findAndCount).toHaveBeenCalledWith({
        where: { deviceId: 'device-1' },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 20,
        skip: 0,
      });
      expect(result).toEqual({
        items: mockItems,
        total: 1,
        limit: 20,
        offset: 0,
      });
    });

    it('should clamp limit to 100 if limit exceeds 100', async () => {
      auditRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getTuningHistory('device-1', 150, 0);

      expect(auditRepo.findAndCount).toHaveBeenCalledWith({
        where: { deviceId: 'device-1' },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 100,
        skip: 0,
      });
      expect(result.limit).toBe(100);
    });

    it('should fallback limit to 20 if limit is less than 1 or not an integer', async () => {
      auditRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getTuningHistory('device-1', -5, 10);
      expect(auditRepo.findAndCount).toHaveBeenLastCalledWith({
        where: { deviceId: 'device-1' },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 20,
        skip: 10,
      });

      await service.getTuningHistory('device-1', 0, 10);
      expect(auditRepo.findAndCount).toHaveBeenLastCalledWith({
        where: { deviceId: 'device-1' },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 20,
        skip: 10,
      });
    });

    it('should fallback offset to 0 if offset is negative or invalid', async () => {
      auditRepo.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getTuningHistory('device-1', 10, -15);

      expect(auditRepo.findAndCount).toHaveBeenCalledWith({
        where: { deviceId: 'device-1' },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 10,
        skip: 0,
      });
      expect(result.offset).toBe(0);
    });

    it('should trim deviceId and strictly filter audit logs by deviceId', async () => {
      auditRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.getTuningHistory('  device-99  ', 30, 50);

      expect(auditRepo.findAndCount).toHaveBeenCalledWith({
        where: { deviceId: 'device-99' },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 30,
        skip: 50,
      });
    });
  });
});


