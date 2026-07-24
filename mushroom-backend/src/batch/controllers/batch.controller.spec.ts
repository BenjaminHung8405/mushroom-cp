/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { BatchController } from './batch.controller';
import { BatchService } from '../services/batch.service';
import { CropBatch } from '../entities/crop-batch.entity';

describe('BatchController', () => {
  let controller: BatchController;
  let service: jest.Mocked<BatchService>;

  const mockBatchService = () => ({
    createBatch: jest.fn(),
    endBatch: jest.fn(),
    getActiveBatchStatusByHouseId: jest.fn(),
    updateBatchCheckpoints: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BatchController],
      providers: [
        {
          provide: BatchService,
          useFactory: mockBatchService,
        },
      ],
    }).compile();

    controller = module.get<BatchController>(BatchController);
    service = module.get(BatchService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call service.createBatch and return the created batch', async () => {
      const mockDto = {
        houseId: 'house-1',
        profileName: 'Dry Season',
        totalCropDays: 30,
      };
      const mockResult = { ...mockDto, status: 'ACTIVE' } as CropBatch;
      service.createBatch.mockResolvedValue(mockResult);

      const result = await controller.create(mockDto);
      expect(result).toEqual(mockResult);
      expect(service.createBatch).toHaveBeenCalledWith(mockDto);
    });
  });

  describe('end', () => {
    it('should call service.endBatch and return the updated batch', async () => {
      const mockResult = { id: 'batch-1', status: 'COMPLETED' } as CropBatch;
      service.endBatch.mockResolvedValue(mockResult);

      const result = await controller.end(
        { id: 'batch-1' },
        { status: 'COMPLETED' },
      );
      expect(result).toEqual(mockResult);
      expect(service.endBatch).toHaveBeenCalledWith('batch-1', 'COMPLETED');
    });
  });

  describe('getActive', () => {
    it('should call service.getActiveBatchByHouseId and return active batch or null', async () => {
      const mockResult = {
        houseId: 'house-1',
        status: 'ACTIVE',
      } as CropBatch;
      service.getActiveBatchStatusByHouseId.mockResolvedValue(
        mockResult as any,
      );

      const result = await controller.getActive({ houseId: 'house-1' });
      expect(result).toEqual(mockResult);
      expect(service.getActiveBatchStatusByHouseId).toHaveBeenCalledWith(
        'house-1',
      );
    });

    it('should return null if no active batch is found', async () => {
      service.getActiveBatchStatusByHouseId.mockResolvedValue(null);

      const result = await controller.getActive({ houseId: 'house-2' });
      expect(result).toBeNull();
      expect(service.getActiveBatchStatusByHouseId).toHaveBeenCalledWith(
        'house-2',
      );
    });
  });

  describe('updateCheckpoints', () => {
    it('should call service.updateBatchCheckpoints and return the updated checkpoints', async () => {
      const mockCheckpoints = [
        {
          id: 1,
          batchId: 'batch-1',
          metricType: 'TEMPERATURE',
          cropDay: 1,
          targetValue: 30,
        },
      ] as any[];
      service.updateBatchCheckpoints.mockResolvedValue(mockCheckpoints);

      const dto = {
        checkpoints: [
          { metricType: 'TEMPERATURE' as any, cropDay: 1, targetValue: 30 },
        ],
      };

      const result = await controller.updateCheckpoints({ id: 'batch-1' }, dto);
      expect(result).toEqual(mockCheckpoints);
      expect(service.updateBatchCheckpoints).toHaveBeenCalledWith(
        'batch-1',
        dto,
      );
    });
  });
});
