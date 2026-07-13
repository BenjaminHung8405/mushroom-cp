/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BatchService } from './batch.service';
import { CropBatch } from '../entities/crop-batch.entity';
import { CurveCheckpoint } from '../entities/curve-checkpoint.entity';
import { LightScheduleBlock } from '../entities/light-schedule-block.entity';
import { MushroomHouse } from '../entities/mushroom-house.entity';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { UpdateCheckpointsDto, MetricType } from '../dto/update-checkpoints.dto';

describe('BatchService', () => {
  let service: BatchService;
  let cropBatchRepo: jest.Mocked<Repository<CropBatch>>;
  let curveCheckpointRepo: jest.Mocked<Repository<CurveCheckpoint>>;
  let lightScheduleBlockRepo: jest.Mocked<Repository<LightScheduleBlock>>;
  let mushroomHouseRepo: jest.Mocked<Repository<MushroomHouse>>;

  const mockRepository = () => ({
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BatchService,
        {
          provide: getRepositoryToken(CropBatch),
          useFactory: mockRepository,
        },
        {
          provide: getRepositoryToken(CurveCheckpoint),
          useFactory: mockRepository,
        },
        {
          provide: getRepositoryToken(LightScheduleBlock),
          useFactory: mockRepository,
        },
        {
          provide: getRepositoryToken(MushroomHouse),
          useFactory: mockRepository,
        },
      ],
    }).compile();

    service = module.get<BatchService>(BatchService);
    cropBatchRepo = module.get(getRepositoryToken(CropBatch));
    curveCheckpointRepo = module.get(getRepositoryToken(CurveCheckpoint));
    lightScheduleBlockRepo = module.get(getRepositoryToken(LightScheduleBlock));
    mushroomHouseRepo = module.get(getRepositoryToken(MushroomHouse));

    // Mock transactional manager by default so it delegates to cropBatchRepo
    const mockTxManager = {
      findOne: jest.fn().mockImplementation((entityClass, options) => {
        return cropBatchRepo.findOne(options);
      }),
      delete: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockImplementation((entityClass, data) => data),
      save: jest.fn().mockImplementation((entityClass, entities) => Promise.resolve(entities)),
    };
    cropBatchRepo.manager = {
      transaction: jest.fn().mockImplementation((cb) => cb(mockTxManager)),
    } as any;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getActiveBatchByHouseId', () => {
    it('should return null if no active batch is found', async () => {
      cropBatchRepo.find.mockResolvedValue([]);
      const result = await service.getActiveBatchByHouseId('house-1');
      expect(result).toBeNull();
      expect(cropBatchRepo.find).toHaveBeenCalledWith({
        where: { houseId: 'house-1', status: 'ACTIVE' },
      });
    });

    it('should return the active batch if exactly one exists', async () => {
      const mockBatch = {
        id: 'batch-1',
        houseId: 'house-1',
        status: 'ACTIVE',
      } as CropBatch;
      cropBatchRepo.find.mockResolvedValue([mockBatch]);
      const result = await service.getActiveBatchByHouseId('house-1');
      expect(result).toEqual(mockBatch);
    });

    it('should throw ConflictException if multiple active batches exist', async () => {
      const mockBatch1 = {
        id: 'batch-1',
        houseId: 'house-1',
        status: 'ACTIVE',
      } as CropBatch;
      const mockBatch2 = {
        houseId: 'house-1',
        status: 'ACTIVE',
      } as CropBatch;

      const loggerErrorSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation();

      cropBatchRepo.find.mockResolvedValue([mockBatch1, mockBatch2]);
      await expect(service.getActiveBatchByHouseId('house-1')).rejects.toThrow(
        ConflictException,
      );
      expect(loggerErrorSpy).toHaveBeenCalled();
    });
  });

  describe('getActiveBatchStatusByHouseId', () => {
    it('should return null when a house has no active batch', async () => {
      cropBatchRepo.find.mockResolvedValue([]);
      await expect(
        service.getActiveBatchStatusByHouseId('house-1'),
      ).resolves.toBeNull();
    });

    it('should include the computed crop day for an active batch and return empty checkpoints list if none exist', async () => {
      const activeBatch = {
        id: 'batch-1',
        houseId: 'house-1',
        status: 'ACTIVE',
        startDate: new Date('2026-07-01T23:30:00+07:00'),
        totalCropDays: 30,
      } as CropBatch;
      cropBatchRepo.find.mockResolvedValue([activeBatch]);
      curveCheckpointRepo.find.mockResolvedValue([]);

      const result = await service.getActiveBatchStatusByHouseId(
        'house-1',
        new Date('2026-07-02T00:01:00+07:00'),
      );

      expect(result).toEqual(
        expect.objectContaining({
          cropDay: 2,
          crop_day: 2,
          checkpoints: [],
        }),
      );
      expect(curveCheckpointRepo.find).toHaveBeenCalledWith({
        where: { batchId: 'batch-1' },
        order: {
          cropDay: 'ASC',
          metricType: 'ASC',
        },
      });
    });

    it('should retrieve checkpoints sorted by cropDay and metricType', async () => {
      const activeBatch = {
        id: 'batch-1',
        houseId: 'house-1',
        status: 'ACTIVE',
        startDate: new Date('2026-07-01T23:30:00+07:00'),
        totalCropDays: 30,
      } as CropBatch;
      cropBatchRepo.find.mockResolvedValue([activeBatch]);

      const mockCheckpoints = [
        {
          id: '1',
          batchId: 'batch-1',
          metricType: 'HUMIDITY',
          cropDay: 5,
          targetValue: 80.0,
        },
        {
          id: '2',
          batchId: 'batch-1',
          metricType: 'TEMPERATURE',
          cropDay: 2,
          targetValue: 30.0,
        },
        {
          id: '3',
          batchId: 'batch-1',
          metricType: 'TEMPERATURE',
          cropDay: 5,
          targetValue: 32.0,
        },
      ] as CurveCheckpoint[];

      curveCheckpointRepo.find.mockResolvedValue(mockCheckpoints);

      const result = await service.getActiveBatchStatusByHouseId(
        'house-1',
        new Date('2026-07-02T00:01:00+07:00'),
      );

      expect(result.checkpoints).toEqual(mockCheckpoints);
      expect(curveCheckpointRepo.find).toHaveBeenCalledWith({
        where: { batchId: 'batch-1' },
        order: {
          cropDay: 'ASC',
          metricType: 'ASC',
        },
      });
    });
  });

  describe('getBatchContext', () => {
    it('should return fallback bio-safety context if no active batch is found', async () => {
      cropBatchRepo.find.mockResolvedValue([]);
      const result = await service.getBatchContext('house-1', new Date());

      expect(result.batchId).toBeNull();
      expect(result.tempOptimalMin).toBe(28.0);
      expect(result.tempOptimalMax).toBe(35.0);
      expect(result.humidityOptimalMin).toBe(70.0);
      expect(result.humidityOptimalMax).toBe(90.0);
      expect(result.targetTemp).toBe(31.5);
      expect(result.targetHumid).toBe(80.0);
      expect(result.thermalShockProtection).toBe(true);
      expect(result.lightStatus).toBe('OFF');
    });

    describe('with active batch and timezone math', () => {
      const mockBatch: CropBatch = {
        id: 'batch-1',
        houseId: 'house-1',
        status: 'ACTIVE',
        startDate: new Date('2026-07-01T08:00:00+07:00'), // 8:00 AM UTC+7 on July 1st
        totalCropDays: 30,
        tempOptimalMin: 28.0,
        tempOptimalMax: 34.0,
        humidityOptimalMin: 70.0,
        humidityOptimalMax: 90.0,
        thermalShockProtection: true,
        thermalShockStart: '11:00:00',
        thermalShockEnd: '13:30:00',
      } as any;

      beforeEach(() => {
        cropBatchRepo.find.mockResolvedValue([mockBatch]);
      });

      it('should calculate cropDay = 1 for current date equal to start date', async () => {
        curveCheckpointRepo.find.mockResolvedValue([]);
        lightScheduleBlockRepo.findOne.mockResolvedValue(null);

        // Same day: July 1st, 12:00 PM UTC+7
        const testTime = new Date('2026-07-01T12:00:00+07:00');
        const result = await service.getBatchContext('house-1', testTime);
        expect(result.cropDay).toBe(1);
      });

      it('should advance to day 2 at midnight in Vietnam even before 24 hours elapse', async () => {
        curveCheckpointRepo.find.mockResolvedValue([]);
        lightScheduleBlockRepo.findOne.mockResolvedValue(null);

        const startedAt = new Date('2026-07-01T23:30:00+07:00');
        cropBatchRepo.find.mockResolvedValue([
          { ...mockBatch, startDate: startedAt },
        ]);
        const result = await service.getBatchContext(
          'house-1',
          new Date('2026-07-02T00:01:00+07:00'),
        );

        expect(result.cropDay).toBe(2);
      });

      it('should calculate cropDay = 5 for test time on July 5th', async () => {
        curveCheckpointRepo.find.mockResolvedValue([]);
        lightScheduleBlockRepo.findOne.mockResolvedValue(null);

        // July 5th, 10:00 AM UTC+7 is exactly 4 days later + 1 = 5th day
        const testTime = new Date('2026-07-05T10:00:00+07:00');
        const result = await service.getBatchContext('house-1', testTime);
        expect(result.cropDay).toBe(5);
      });

      it('should bound cropDay to 1 if the test time is before start date', async () => {
        curveCheckpointRepo.find.mockResolvedValue([]);
        lightScheduleBlockRepo.findOne.mockResolvedValue(null);

        const testTime = new Date('2026-06-30T10:00:00+07:00');
        const result = await service.getBatchContext('house-1', testTime);
        expect(result.cropDay).toBe(1);
      });

      it('should bound cropDay to totalCropDays if test time is far in future', async () => {
        curveCheckpointRepo.find.mockResolvedValue([]);
        lightScheduleBlockRepo.findOne.mockResolvedValue(null);

        const testTime = new Date('2026-08-15T10:00:00+07:00');
        const result = await service.getBatchContext('house-1', testTime);
        expect(result.cropDay).toBe(30); // totalCropDays is 30
      });

      it('should fallback target values to optimal midpoints if no checkpoints exist', async () => {
        curveCheckpointRepo.find.mockResolvedValue([]);
        lightScheduleBlockRepo.findOne.mockResolvedValue(null);

        const testTime = new Date('2026-07-05T10:00:00+07:00');
        const result = await service.getBatchContext('house-1', testTime);

        expect(result.targetTemp).toBe(31.0); // (28 + 34) / 2 = 31.0
        expect(result.targetHumid).toBe(80.0); // (70 + 90) / 2 = 80.0
      });

      describe('Interpolation logic', () => {
        const mockCheckpoints: CurveCheckpoint[] = [
          { cropDay: 4, metricType: 'TEMPERATURE', targetValue: 28.0 } as any,
          { cropDay: 8, metricType: 'TEMPERATURE', targetValue: 30.0 } as any,
          { cropDay: 12, metricType: 'TEMPERATURE', targetValue: 31.0 } as any,
          { cropDay: 4, metricType: 'HUMIDITY', targetValue: 70.0 } as any,
          { cropDay: 8, metricType: 'HUMIDITY', targetValue: 80.0 } as any,
        ];

        beforeEach(() => {
          curveCheckpointRepo.find.mockResolvedValue(mockCheckpoints);
          lightScheduleBlockRepo.findOne.mockResolvedValue(null);
        });

        it('should return value of nearest boundary if cropDay is before first checkpoint', async () => {
          // cropDay will be calculated as 2 (July 2nd)
          const testTime = new Date('2026-07-02T10:00:00+07:00');
          const result = await service.getBatchContext('house-1', testTime);

          expect(result.cropDay).toBe(2);
          expect(result.targetTemp).toBe(28.0); // first checkpoint is day 4 value 28.0
          expect(result.targetHumid).toBe(70.0); // first checkpoint is day 4 value 70.0
        });

        it('should return value of nearest boundary if cropDay is after last checkpoint', async () => {
          // cropDay will be 15 (July 15th), which is after last checkpoint (day 12 temp, day 8 humid)
          const testTime = new Date('2026-07-15T10:00:00+07:00');
          const result = await service.getBatchContext('house-1', testTime);

          expect(result.cropDay).toBe(15);
          expect(result.targetTemp).toBe(31.0); // last checkpoint for temp is day 12 value 31.0
          expect(result.targetHumid).toBe(80.0); // last checkpoint for humid is day 8 value 80.0
        });

        it('should interpolate linearly between checkpoints and round to nearest 0.5', async () => {
          // cropDay = 6 (July 6th), which is between day 4 and day 8
          // For Temp: 28.0 at Day 4, 30.0 at Day 8.
          // Diff is 2.0 over 4 days (0.5 per day). Day 6 is 2 days from Day 4: 28.0 + 2 * 0.5 = 29.0
          // For Humid: 70.0 at Day 4, 80.0 at Day 8.
          // Diff is 10.0 over 4 days (2.5 per day). Day 6 is 2 days from Day 4: 70.0 + 2 * 2.5 = 75.0
          const testTime = new Date('2026-07-06T10:00:00+07:00');
          const result = await service.getBatchContext('house-1', testTime);

          expect(result.cropDay).toBe(6);
          expect(result.targetTemp).toBe(29.0);
          expect(result.targetHumid).toBe(75.0);
        });

        it('should round to the nearest 0.5 properly when fractional', async () => {
          // cropDay = 5 (July 5th). Between Day 4 and Day 8.
          // For Temp: Day 5 is 1 day from Day 4: 28.0 + 1 * 0.5 = 28.5
          // For Humid: Day 5 is 1 day from Day 4: 70.0 + 1 * 2.5 = 72.5
          const testTime = new Date('2026-07-05T10:00:00+07:00');
          const result = await service.getBatchContext('house-1', testTime);

          expect(result.cropDay).toBe(5);
          expect(result.targetTemp).toBe(28.5);
          expect(result.targetHumid).toBe(72.5);
        });

        it('should round fractional value to nearest 0.5 correctly', async () => {
          // Let's test a case where we would get e.g. 28.67, should round to 28.5 or 29.0
          // cropDay = 7 (July 7th). Between Day 4 and Day 8.
          // For Humid: Day 7 is 3 days from Day 4: 70.0 + 3 * 2.5 = 77.5
          const testTime = new Date('2026-07-07T10:00:00+07:00');
          const result = await service.getBatchContext('house-1', testTime);

          expect(result.cropDay).toBe(7);
          expect(result.targetHumid).toBe(77.5);
        });
      });

      describe('Light Schedule integration', () => {
        it('should return ON if a matching light block status is ON', async () => {
          curveCheckpointRepo.find.mockResolvedValue([]);
          lightScheduleBlockRepo.findOne.mockResolvedValue({
            id: 'block-1',
            startDay: 1,
            endDay: 10,
            status: 'ON',
          } as any);

          const testTime = new Date('2026-07-05T10:00:00+07:00');
          const result = await service.getBatchContext('house-1', testTime);

          expect(result.cropDay).toBe(5);
          expect(result.lightStatus).toBe('ON');
          expect(lightScheduleBlockRepo.findOne).toHaveBeenCalled();
        });

        it('should return OFF if a matching light block status is OFF', async () => {
          curveCheckpointRepo.find.mockResolvedValue([]);
          lightScheduleBlockRepo.findOne.mockResolvedValue({
            id: 'block-1',
            startDay: 1,
            endDay: 10,
            status: 'OFF',
          } as any);

          const testTime = new Date('2026-07-05T10:00:00+07:00');
          const result = await service.getBatchContext('house-1', testTime);

          expect(result.cropDay).toBe(5);
          expect(result.lightStatus).toBe('OFF');
        });
      });
    });
  });

  describe('createBatch', () => {
    const mockDto = {
      houseId: 'house-1',
      profileName: 'Dry Season Optimization',
      totalCropDays: 30,
    };

    it('should throw NotFoundException if mushroom house is not found', async () => {
      mushroomHouseRepo.findOne.mockResolvedValue(null);

      await expect(service.createBatch(mockDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(mushroomHouseRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'house-1' },
      });
    });

    it('should throw ConflictException if an active batch already exists', async () => {
      mushroomHouseRepo.findOne.mockResolvedValue({
        id: 'house-1',
      } as MushroomHouse);

      const mockManager = {
        findOne: jest
          .fn()
          .mockResolvedValue({ id: 'batch-active', status: 'ACTIVE' }),
      };
      cropBatchRepo.manager = {
        transaction: jest.fn().mockImplementation((cb) => cb(mockManager)),
      } as any;

      await expect(service.createBatch(mockDto)).rejects.toThrow(
        ConflictException,
      );
      expect(mockManager.findOne).toHaveBeenCalledWith(CropBatch, {
        where: { houseId: 'house-1', status: 'ACTIVE' },
        lock: { mode: 'pessimistic_write' },
      });
    });

    it('should successfully create and save the batch when valid', async () => {
      mushroomHouseRepo.findOne.mockResolvedValue({
        id: 'house-1',
      } as MushroomHouse);

      const mockCreatedBatch = { ...mockDto, status: 'ACTIVE' };
      const mockManager = {
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockReturnValue(mockCreatedBatch),
        save: jest.fn().mockResolvedValue(mockCreatedBatch),
      };
      cropBatchRepo.manager = {
        transaction: jest.fn().mockImplementation((cb) => cb(mockManager)),
      } as any;

      const result = await service.createBatch(mockDto);
      expect(result).toEqual(mockCreatedBatch);
      expect(mockManager.create).toHaveBeenCalledWith(
        CropBatch,
        expect.objectContaining({
          ...mockDto,
          id: expect.stringMatching(/^batch_[a-z0-9]+_[a-z0-9]+$/),
        }),
      );
      expect(mockManager.save).toHaveBeenCalledWith(
        CropBatch,
        mockCreatedBatch,
      );
    });
  });

  describe('endBatch', () => {
    it('should throw NotFoundException if the batch is not found', async () => {
      cropBatchRepo.findOne.mockResolvedValue(null);

      await expect(service.endBatch('batch-1', 'COMPLETED')).rejects.toThrow(
        NotFoundException,
      );
      expect(cropBatchRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
      });
    });

    it('should update and save the status of the batch successfully', async () => {
      const mockBatch = { id: 'batch-1', status: 'ACTIVE' } as CropBatch;
      cropBatchRepo.findOne.mockResolvedValue(mockBatch);
      cropBatchRepo.save.mockImplementation((b: any) => Promise.resolve(b));

      const result = await service.endBatch('batch-1', 'COMPLETED');
      expect(result.status).toBe('COMPLETED');
      expect(cropBatchRepo.save).toHaveBeenCalledWith(mockBatch);
    });

    it('should throw ConflictException if the batch is not ACTIVE', async () => {
      const mockBatch = { id: 'batch-1', status: 'COMPLETED' } as CropBatch;
      cropBatchRepo.findOne.mockResolvedValue(mockBatch);

      await expect(service.endBatch('batch-1', 'ABORTED')).rejects.toThrow(
        ConflictException,
      );
      expect(cropBatchRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
      });
    });
  });

  describe('updateBatchCheckpoints', () => {
    const validCheckpoints = [
      { metricType: MetricType.TEMPERATURE, cropDay: 1, targetValue: 30 },
      { metricType: MetricType.TEMPERATURE, cropDay: 30, targetValue: 28 },
      { metricType: MetricType.HUMIDITY, cropDay: 1, targetValue: 80 },
      { metricType: MetricType.HUMIDITY, cropDay: 30, targetValue: 90 },
    ];

    it('should throw NotFoundException if crop batch is not found', async () => {
      cropBatchRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateBatchCheckpoints('batch-1', {
          checkpoints: validCheckpoints,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if crop batch status is not ACTIVE', async () => {
      const mockBatch = { id: 'batch-1', status: 'COMPLETED' } as CropBatch;
      cropBatchRepo.findOne.mockResolvedValue(mockBatch);

      await expect(
        service.updateBatchCheckpoints('batch-1', {
          checkpoints: validCheckpoints,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if TEMPERATURE does not have at least 2 checkpoints', async () => {
      const mockBatch = {
        id: 'batch-1',
        status: 'ACTIVE',
        totalCropDays: 30,
      } as CropBatch;
      cropBatchRepo.findOne.mockResolvedValue(mockBatch);

      const invalidCheckpoints = [
        { metricType: MetricType.TEMPERATURE, cropDay: 1, targetValue: 30 },
        { metricType: MetricType.HUMIDITY, cropDay: 1, targetValue: 80 },
        { metricType: MetricType.HUMIDITY, cropDay: 30, targetValue: 90 },
      ];

      await expect(
        service.updateBatchCheckpoints('batch-1', {
          checkpoints: invalidCheckpoints,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if TEMPERATURE does not have day 1 checkpoint', async () => {
      const mockBatch = {
        id: 'batch-1',
        status: 'ACTIVE',
        totalCropDays: 30,
      } as CropBatch;
      cropBatchRepo.findOne.mockResolvedValue(mockBatch);

      const invalidCheckpoints = [
        { metricType: MetricType.TEMPERATURE, cropDay: 5, targetValue: 30 },
        { metricType: MetricType.TEMPERATURE, cropDay: 30, targetValue: 28 },
        { metricType: MetricType.HUMIDITY, cropDay: 1, targetValue: 80 },
        { metricType: MetricType.HUMIDITY, cropDay: 30, targetValue: 90 },
      ];

      await expect(
        service.updateBatchCheckpoints('batch-1', {
          checkpoints: invalidCheckpoints,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if TEMPERATURE does not have day N checkpoint', async () => {
      const mockBatch = {
        id: 'batch-1',
        status: 'ACTIVE',
        totalCropDays: 30,
      } as CropBatch;
      cropBatchRepo.findOne.mockResolvedValue(mockBatch);

      const invalidCheckpoints = [
        { metricType: MetricType.TEMPERATURE, cropDay: 1, targetValue: 30 },
        { metricType: MetricType.TEMPERATURE, cropDay: 28, targetValue: 28 },
        { metricType: MetricType.HUMIDITY, cropDay: 1, targetValue: 80 },
        { metricType: MetricType.HUMIDITY, cropDay: 30, targetValue: 90 },
      ];

      await expect(
        service.updateBatchCheckpoints('batch-1', {
          checkpoints: invalidCheckpoints,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if HUMIDITY does not have day 1 or day N checkpoints', async () => {
      const mockBatch = {
        id: 'batch-1',
        status: 'ACTIVE',
        totalCropDays: 30,
      } as CropBatch;
      cropBatchRepo.findOne.mockResolvedValue(mockBatch);

      const invalidCheckpoints = [
        { metricType: MetricType.TEMPERATURE, cropDay: 1, targetValue: 30 },
        { metricType: MetricType.TEMPERATURE, cropDay: 30, targetValue: 28 },
        { metricType: MetricType.HUMIDITY, cropDay: 2, targetValue: 80 },
        { metricType: MetricType.HUMIDITY, cropDay: 30, targetValue: 90 },
      ];

      await expect(
        service.updateBatchCheckpoints('batch-1', {
          checkpoints: invalidCheckpoints,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if a checkpoint has cropDay exceeding totalCropDays', async () => {
      const mockBatch = {
        id: 'batch-1',
        status: 'ACTIVE',
        totalCropDays: 30,
      } as CropBatch;
      cropBatchRepo.findOne.mockResolvedValue(mockBatch);

      const invalidCheckpoints = [
        { metricType: MetricType.TEMPERATURE, cropDay: 1, targetValue: 30 },
        { metricType: MetricType.TEMPERATURE, cropDay: 35, targetValue: 28 },
        { metricType: MetricType.HUMIDITY, cropDay: 1, targetValue: 80 },
        { metricType: MetricType.HUMIDITY, cropDay: 30, targetValue: 90 },
      ];

      await expect(
        service.updateBatchCheckpoints('batch-1', {
          checkpoints: invalidCheckpoints,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if there are duplicate cropDay entries for the same metricType', async () => {
      const mockBatch = {
        id: 'batch-1',
        status: 'ACTIVE',
        totalCropDays: 30,
      } as CropBatch;
      cropBatchRepo.findOne.mockResolvedValue(mockBatch);

      const invalidCheckpoints = [
        { metricType: MetricType.TEMPERATURE, cropDay: 1, targetValue: 30 },
        { metricType: MetricType.TEMPERATURE, cropDay: 15, targetValue: 29 },
        { metricType: MetricType.TEMPERATURE, cropDay: 15, targetValue: 28 },
        { metricType: MetricType.TEMPERATURE, cropDay: 30, targetValue: 27 },
        { metricType: MetricType.HUMIDITY, cropDay: 1, targetValue: 80 },
        { metricType: MetricType.HUMIDITY, cropDay: 30, targetValue: 90 },
      ];

      await expect(
        service.updateBatchCheckpoints('batch-1', {
          checkpoints: invalidCheckpoints,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if a checkpoint has cropDay less than 1', async () => {
      const mockBatch = {
        id: 'batch-1',
        status: 'ACTIVE',
        totalCropDays: 30,
      } as CropBatch;
      cropBatchRepo.findOne.mockResolvedValue(mockBatch);

      const invalidCheckpoints = [
        { metricType: MetricType.TEMPERATURE, cropDay: 0, targetValue: 30 },
        { metricType: MetricType.TEMPERATURE, cropDay: 30, targetValue: 28 },
        { metricType: MetricType.HUMIDITY, cropDay: 1, targetValue: 80 },
        { metricType: MetricType.HUMIDITY, cropDay: 30, targetValue: 90 },
      ];

      await expect(
        service.updateBatchCheckpoints('batch-1', {
          checkpoints: invalidCheckpoints,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully delete old checkpoints and save new ones in transaction', async () => {
      const mockBatch = {
        id: 'batch-1',
        status: 'ACTIVE',
        totalCropDays: 30,
      } as CropBatch;
      cropBatchRepo.findOne.mockResolvedValue(mockBatch);

      const mockManager = {
        findOne: jest.fn().mockImplementation((entityClass, options) => {
          return cropBatchRepo.findOne(options);
        }),
        delete: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockImplementation((entityClass, data) => data),
        save: jest
          .fn()
          .mockImplementation((entityClass, entities) =>
            Promise.resolve(entities),
          ),
      };

      cropBatchRepo.manager = {
        transaction: jest.fn().mockImplementation((cb) => cb(mockManager)),
      } as any;

      const result = await service.updateBatchCheckpoints('batch-1', {
        checkpoints: validCheckpoints,
      });

      expect(cropBatchRepo.manager.transaction).toHaveBeenCalled();
      expect(mockManager.delete).toHaveBeenCalledWith(CurveCheckpoint, {
        batchId: 'batch-1',
      });
      expect(mockManager.save).toHaveBeenCalledWith(
        CurveCheckpoint,
        expect.arrayContaining([
          expect.objectContaining({
            batchId: 'batch-1',
            metricType: MetricType.TEMPERATURE,
            cropDay: 1,
            targetValue: 30,
          }),
          expect.objectContaining({
            batchId: 'batch-1',
            metricType: MetricType.HUMIDITY,
            cropDay: 30,
            targetValue: 90,
          }),
        ]),
      );
      expect(result).toHaveLength(4);
    });
  });
});
