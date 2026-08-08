import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminDevicesController } from './admin-devices.controller';
import { Device } from '../device/entities/device.entity';
import { MushroomHouse } from '../batch/entities/mushroom-house.entity';
import { User, UserRole } from './entities/user.entity';
import { AuthService } from './auth.service';
import { DeviceRegistryService } from '../device/device-registry.service';
import { MqttService } from '../mqtt/mqtt.service';
import type { AuthPrincipal } from './auth.types';

describe('AdminDevicesController', () => {
  let controller: AdminDevicesController;
  let deviceRepo: any;
  let houseRepo: any;
  let userRepo: any;
  let authService: any;
  let registryService: any;
  let mqttService: any;

  const mockActor: AuthPrincipal = {
    id: 'admin-uuid',
    phoneNumber: '+84901234567',
    role: UserRole.ADMIN,
    houseIds: [],
    mustSetPin: false,
    authMode: 'SESSION',
  };

  let mockQueryBuilder: any;

  beforeEach(async () => {
    mockQueryBuilder = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
      getRawMany: jest.fn(),
    };

    deviceRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      exists: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) =>
        Promise.resolve({ ...dto, createdAt: new Date() }),
      ),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    houseRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'house_b1', name: 'Nhà B1' }]),
      findOneBy: jest
        .fn()
        .mockResolvedValue({ id: 'house_b1', name: 'Nhà B1' }),
    };

    userRepo = {
      find: jest
        .fn()
        .mockResolvedValue([{ id: 'op-1', phoneNumber: '+84901111111' }]),
    };

    authService = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    registryService = {
      refreshOne: jest.fn().mockResolvedValue(undefined),
    };

    mqttService = {
      kickDevice: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminDevicesController],
      providers: [
        { provide: getRepositoryToken(Device), useValue: deviceRepo },
        { provide: getRepositoryToken(MushroomHouse), useValue: houseRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: AuthService, useValue: authService },
        { provide: DeviceRegistryService, useValue: registryService },
        { provide: MqttService, useValue: mqttService },
      ],
    }).compile();

    controller = module.get<AdminDevicesController>(AdminDevicesController);
  });

  it('should list devices with online status calculation and pagination metadata', async () => {
    mockQueryBuilder.getRawMany.mockResolvedValue([
      {
        deviceId: 'mushroom_s3_123',
        displayName: 'Thiết bị B1',
        houseId: 'house_b1',
        houseName: 'Nhà B1',
        ownerUserId: 'op-1',
        ownerPhone: '+84901111111',
        enabled: true,
        lastSeenAt: new Date(),
        createdAt: new Date(),
      },
    ]);

    const res = await controller.list({ page: 1, limit: 10 });
    expect(res.data).toHaveLength(1);
    expect(res.data[0].onlineStatus).toBe('online');
    expect(res.meta).toEqual({ total: 1, page: 1, limit: 10 });
    expect(mockQueryBuilder.offset).toHaveBeenCalledWith(0);
    expect(mockQueryBuilder.limit).toHaveBeenCalledWith(10);
  });

  it('should fallback ownerPhone to null instead of UUID string when missing', async () => {
    mockQueryBuilder.getRawMany.mockResolvedValue([
      {
        deviceId: 'mushroom_s3_456',
        displayName: 'Thiết bị B2',
        houseId: 'house_b1',
        houseName: 'Nhà B1',
        ownerUserId: 'op-uuid-without-phone',
        ownerPhone: null,
        enabled: true,
        lastSeenAt: null,
        createdAt: new Date(),
      },
    ]);

    const res = await controller.list();
    expect(res.data[0].ownerPhone).toBeNull();
  });

  it('should create a device and return a one-time raw token', async () => {
    deviceRepo.exists.mockResolvedValue(false);
    const res = await controller.create(
      { deviceId: 'mushroom_s3_123', houseId: 'house_b1' },
      mockActor,
    );
    expect(res.deviceId).toBe('mushroom_s3_123');
    expect(res.ownerUserId).toBeNull();
    expect(res.rawToken).toBeDefined();
    expect(res.rawToken).toHaveLength(64);
    expect(authService.record).toHaveBeenCalledWith(
      'DEVICE_CREATED',
      'admin-uuid',
      'mushroom_s3_123',
      expect.anything(),
      'SUCCESS',
      expect.anything(),
    );
  });

  it('should kick MQTT session when a device is disabled via update', async () => {
    deviceRepo.findOneBy.mockResolvedValue({
      deviceId: 'mushroom_s3_123',
      houseId: 'house_b1',
      enabled: true,
    });

    await controller.update('mushroom_s3_123', { enabled: false }, mockActor);
    expect(mqttService.kickDevice).toHaveBeenCalledWith('mushroom_s3_123');
    expect(authService.record).toHaveBeenCalledWith(
      'DEVICE_DISABLED',
      'admin-uuid',
      'mushroom_s3_123',
      expect.anything(),
      'SUCCESS',
      expect.anything(),
    );
  });

  it('should regenerate raw token for an existing device', async () => {
    deviceRepo.findOneBy.mockResolvedValue({
      deviceId: 'mushroom_s3_123',
      token: 'old-token',
    });

    const res = await controller.regenerateToken('mushroom_s3_123', mockActor);
    expect(res.rawToken).toBeDefined();
    expect(res.rawToken).not.toBe('old-token');
    expect(authService.record).toHaveBeenCalledWith(
      'DEVICE_TOKEN_REGENERATED',
      'admin-uuid',
      'mushroom_s3_123',
      expect.anything(),
      'SUCCESS',
    );
  });
});
