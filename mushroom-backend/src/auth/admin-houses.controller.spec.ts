import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AdminHousesController } from './admin-houses.controller';
import { MushroomHouse } from '../batch/entities/mushroom-house.entity';
import { Device } from '../device/entities/device.entity';
import { UserHouseAccess } from './entities/user-house-access.entity';
import { AuthService } from './auth.service';
import type { AuthPrincipal } from './auth.types';
import { UserRole } from './entities/user.entity';

describe('AdminHousesController', () => {
  let controller: AdminHousesController;
  let houseRepo: any;
  let deviceRepo: any;
  let accessRepo: any;
  let authService: any;

  const mockActor: AuthPrincipal = {
    id: 'admin-uuid',
    phoneNumber: '+84901234567',
    role: UserRole.ADMIN,
    houseIds: [],
    mustSetPin: false,
    authMode: 'SESSION',
  };

  beforeEach(async () => {
    houseRepo = {
      find: jest.fn(),
      findOneBy: jest.fn(),
      exists: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn((dto) => Promise.resolve({ ...dto, createdAt: new Date() })),
      delete: jest.fn(),
    };

    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
    };

    deviceRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
      count: jest.fn(),
    };

    accessRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };

    authService = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminHousesController],
      providers: [
        { provide: getRepositoryToken(MushroomHouse), useValue: houseRepo },
        { provide: getRepositoryToken(Device), useValue: deviceRepo },
        { provide: getRepositoryToken(UserHouseAccess), useValue: accessRepo },
        { provide: AuthService, useValue: authService },
      ],
    }).compile();

    controller = module.get<AdminHousesController>(AdminHousesController);
  });

  it('should list houses with device and user counts', async () => {
    houseRepo.find.mockResolvedValue([
      { id: 'house_b1', name: 'Nhà B1', areaMeters: '4x6', pillarCount: 35, createdAt: new Date() },
    ]);
    const res = await controller.list();
    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).toBe('house_b1');
    expect(res.meta.total).toBe(1);
  });

  it('should create a new house', async () => {
    houseRepo.exists.mockResolvedValue(false);
    const dto = { id: 'house_b2', name: 'Nhà B2', areaMeters: '4x6', pillarCount: 35 };
    const res = await controller.create(dto, mockActor);
    expect(res.id).toBe('house_b2');
    expect(authService.record).toHaveBeenCalledWith(
      'HOUSE_CREATED',
      'admin-uuid',
      'house_b2',
      expect.anything(),
      'SUCCESS',
      expect.anything(),
    );
  });

  it('should throw ConflictException when creating house with duplicate ID', async () => {
    houseRepo.exists.mockResolvedValue(true);
    await expect(
      controller.create({ id: 'house_b1', name: 'Nhà B1' }, mockActor),
    ).rejects.toThrow(ConflictException);
  });

  it('should prevent deletion of house with active devices', async () => {
    houseRepo.findOneBy.mockResolvedValue({ id: 'house_b1', name: 'Nhà B1' });
    deviceRepo.count.mockResolvedValue(2);
    await expect(controller.delete('house_b1', mockActor)).rejects.toThrow(ConflictException);
  });

  it('should delete house when no active devices exist', async () => {
    houseRepo.findOneBy.mockResolvedValue({ id: 'house_b1', name: 'Nhà B1' });
    deviceRepo.count.mockResolvedValue(0);
    const res = await controller.delete('house_b1', mockActor);
    expect(res.message).toContain('thành công');
    expect(houseRepo.delete).toHaveBeenCalledWith({ id: 'house_b1' });
  });
});
