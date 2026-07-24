import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { CropBatch } from '../entities/crop-batch.entity';
import { CurveCheckpoint } from '../entities/curve-checkpoint.entity';
import { LightScheduleBlock } from '../entities/light-schedule-block.entity';
import { MushroomHouse } from '../entities/mushroom-house.entity';
import { toZonedTime } from 'date-fns-tz';
import { ActiveBatchResponseDto } from '../dto/active-batch-response.dto';
import { CreateBatchDto } from '../dto/create-batch.dto';
import {
  UpdateCheckpointsDto,
  CheckpointDto,
  MetricType,
} from '../dto/update-checkpoints.dto';
import { LightScheduleBlockDto } from '../dto/update-light-schedule.dto';

export interface BatchContext {
  batchId: string | null;
  batch_id: string | null;
  cropDay: number;
  crop_day: number;
  targetTemp: number;
  target_temp: number;
  targetHumid: number;
  target_humid: number;
  tempOptimalMin: number;
  temp_optimal_min: number;
  tempOptimalMax: number;
  temp_optimal_max: number;
  humidityOptimalMin: number;
  humidity_optimal_min: number;
  humidityOptimalMax: number;
  humidity_optimal_max: number;
  lightStatus: 'ON' | 'OFF';
  light_status: 'ON' | 'OFF';
}

@Injectable()
export class BatchService {
  private readonly logger = new Logger(BatchService.name);

  constructor(
    @InjectRepository(CropBatch)
    private readonly cropBatchRepository: Repository<CropBatch>,
    @InjectRepository(CurveCheckpoint)
    private readonly curveCheckpointRepository: Repository<CurveCheckpoint>,
    @InjectRepository(LightScheduleBlock)
    private readonly lightScheduleBlockRepository: Repository<LightScheduleBlock>,
    @InjectRepository(MushroomHouse)
    private readonly mushroomHouseRepository: Repository<MushroomHouse>,
  ) {}

  /**
   * Retrieves the active crop batch for a specific mushroom house.
   * Enforces the invariant: exactly one ACTIVE batch per house_id.
   * Throws ConflictException if data integrity is violated.
   */
  async getActiveBatchByHouseId(houseId: string): Promise<CropBatch | null> {
    const activeBatches = await this.cropBatchRepository.find({
      where: {
        houseId,
        status: 'ACTIVE',
      },
    });

    if (activeBatches.length > 1) {
      this.logger.error(
        `Data integrity violation: ${activeBatches.length} active batches for house ${houseId}`,
      );
      throw new ConflictException(
        `Data integrity violation: multiple active batches found for house ${houseId}. Manual cleanup required.`,
      );
    }

    return activeBatches[0] ?? null;
  }

  /**
   * Returns the active batch plus its current crop day for dashboard consumers.
   */
  async getActiveBatchStatusByHouseId(
    houseId: string,
    timestamp = new Date(),
  ): Promise<ActiveBatchResponseDto | null> {
    const activeBatch = await this.getActiveBatchByHouseId(houseId);
    if (!activeBatch) {
      return null;
    }

    const cropDay = this.calculateCropDay(activeBatch, timestamp);

    const checkpoints = await this.curveCheckpointRepository.find({
      where: { batchId: activeBatch.id },
      order: {
        cropDay: 'ASC',
        metricType: 'ASC',
      },
    });
    const lightSchedule =
      (await this.lightScheduleBlockRepository.find({
        where: { batchId: activeBatch.id },
        order: { startDay: 'ASC' },
      })) ?? [];

    return {
      ...activeBatch,
      cropDay,
      crop_day: cropDay,
      checkpoints: (checkpoints || []).map((cp) => ({
        id: cp.id,
        batchId: cp.batchId as string,
        metricType: cp.metricType as MetricType,
        cropDay: cp.cropDay,
        targetValue: cp.targetValue,
      })),
      lightSchedule: lightSchedule.map((block) => ({
        startDay: block.startDay,
        endDay: block.endDay,
        status: block.status,
      })),
    };
  }

  async getBatchLightSchedule(id: string): Promise<LightScheduleBlock[]> {
    const batch = await this.cropBatchRepository.findOne({ where: { id } });
    if (!batch) {
      throw new NotFoundException(`Crop batch with ID '${id}' not found.`);
    }
    return this.lightScheduleBlockRepository.find({
      where: { batchId: id },
      order: { startDay: 'ASC' },
    });
  }

  async updateBatchLightSchedule(
    id: string,
    blocks: LightScheduleBlockDto[],
  ): Promise<LightScheduleBlock[]> {
    return this.cropBatchRepository.manager.transaction(async (manager) => {
      const batch = await manager.findOne(CropBatch, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!batch)
        throw new NotFoundException(`Crop batch with ID '${id}' not found.`);
      if (batch.status !== 'ACTIVE') {
        throw new BadRequestException(
          'Only ACTIVE batches can have light schedules updated.',
        );
      }
      this.validateLightSchedule(blocks, batch.totalCropDays);
      await manager.delete(LightScheduleBlock, { batchId: id });
      const records = blocks.map((block) =>
        manager.create(LightScheduleBlock, { ...block, batchId: id }),
      );
      return manager.save(LightScheduleBlock, records);
    });
  }

  private validateLightSchedule(
    blocks: LightScheduleBlockDto[],
    totalCropDays: number,
  ): void {
    let expectedStart = 1;
    let previousStatus: 'ON' | 'OFF' | null = null;
    for (const block of blocks) {
      if (
        block.startDay > block.endDay ||
        block.startDay < 1 ||
        block.endDay > totalCropDays
      ) {
        throw new BadRequestException(
          `Light schedule block must be within days 1–${totalCropDays}.`,
        );
      }
      if (block.startDay !== expectedStart) {
        throw new BadRequestException(
          'Light schedule blocks must be ordered, contiguous, and non-overlapping.',
        );
      }
      if (block.status === previousStatus) {
        throw new BadRequestException(
          'Adjacent light schedule blocks must have different statuses.',
        );
      }
      expectedStart = block.endDay + 1;
      previousStatus = block.status;
    }
    if (expectedStart !== totalCropDays + 1) {
      throw new BadRequestException(
        `Light schedule must cover every day from 1 to ${totalCropDays}.`,
      );
    }
  }

  /**
   * Calculates and returns the batch context for control outputs.
   * If no active batch exists, returns default bio-safety configurations.
   */
  async getBatchContext(
    houseId: string,
    timestamp: Date,
  ): Promise<BatchContext> {
    const activeBatch = await this.getActiveBatchByHouseId(houseId);

    if (!activeBatch) {
      this.logger.log(
        `No active batch found for house ${houseId}. Returning bio-safety fallback context.`,
      );
      return this.getFallbackContext();
    }

    const cropDay = this.calculateCropDay(activeBatch, timestamp);

    const checkpoints = await this.curveCheckpointRepository.find({
      where: { batchId: activeBatch.id },
    });

    const tempCheckpoints = checkpoints.filter(
      (c) => c.metricType === 'TEMPERATURE',
    );
    const humidityCheckpoints = checkpoints.filter(
      (c) => c.metricType === 'HUMIDITY',
    );

    const defaultTemp =
      Math.round(
        ((activeBatch.tempOptimalMin + activeBatch.tempOptimalMax) / 2) * 2,
      ) / 2;
    const defaultHumid =
      Math.round(
        ((activeBatch.humidityOptimalMin + activeBatch.humidityOptimalMax) /
          2) *
          2,
      ) / 2;

    const targetTemp = this.interpolate(cropDay, tempCheckpoints, defaultTemp);
    const targetHumid = this.interpolate(
      cropDay,
      humidityCheckpoints,
      defaultHumid,
    );

    const lightBlock = await this.lightScheduleBlockRepository.findOne({
      where: {
        batchId: activeBatch.id,
        startDay: LessThanOrEqual(cropDay),
        endDay: MoreThanOrEqual(cropDay),
      },
    });

    const lightStatus: 'ON' | 'OFF' = lightBlock ? lightBlock.status : 'OFF';

    return this.assembleContext(
      activeBatch,
      cropDay,
      targetTemp,
      targetHumid,
      lightStatus,
    );
  }

  /**
   * Calculates crop day from startDate using Asia/Ho_Chi_Minh timezone.
   * Result is clamped to [1, totalCropDays].
   */
  private calculateCropDay(activeBatch: CropBatch, timestamp: Date): number {
    const timezone = 'Asia/Ho_Chi_Minh';
    const zonedNow = toZonedTime(timestamp, timezone);
    const zonedStart = toZonedTime(new Date(activeBatch.startDate), timezone);

    // Compare local calendar dates, not elapsed 24-hour windows. A batch started
    // at any time today remains on day 1 until the next midnight in Vietnam.
    const nowDateUtc = Date.UTC(
      zonedNow.getFullYear(),
      zonedNow.getMonth(),
      zonedNow.getDate(),
    );
    const startDateUtc = Date.UTC(
      zonedStart.getFullYear(),
      zonedStart.getMonth(),
      zonedStart.getDate(),
    );
    let cropDay = Math.floor((nowDateUtc - startDateUtc) / 86_400_000) + 1;

    if (cropDay < 1) {
      cropDay = 1;
    }
    if (cropDay > activeBatch.totalCropDays) {
      cropDay = activeBatch.totalCropDays;
    }

    return cropDay;
  }

  /**
   * Assembles the dual-format BatchContext object from computed values.
   */
  private assembleContext(
    activeBatch: CropBatch,
    cropDay: number,
    targetTemp: number,
    targetHumid: number,
    lightStatus: 'ON' | 'OFF',
  ): BatchContext {
    return {
      batchId: activeBatch.id,
      batch_id: activeBatch.id,
      cropDay,
      crop_day: cropDay,
      targetTemp,
      target_temp: targetTemp,
      targetHumid,
      target_humid: targetHumid,
      tempOptimalMin: activeBatch.tempOptimalMin,
      temp_optimal_min: activeBatch.tempOptimalMin,
      tempOptimalMax: activeBatch.tempOptimalMax,
      temp_optimal_max: activeBatch.tempOptimalMax,
      humidityOptimalMin: activeBatch.humidityOptimalMin,
      humidity_optimal_min: activeBatch.humidityOptimalMin,
      humidityOptimalMax: activeBatch.humidityOptimalMax,
      humidity_optimal_max: activeBatch.humidityOptimalMax,
      lightStatus,
      light_status: lightStatus,
    };
  }

  /**
   * Safely coerces a checkpoint targetValue to a number.
   * PostgreSQL numeric columns may arrive as strings from the driver.
   */
  private safeTargetValue(cc: CurveCheckpoint): number {
    const v = cc.targetValue as number | string | null | undefined;
    return typeof v === 'string' ? parseFloat(v) : (v ?? 0);
  }

  /**
   * Helper to perform linear interpolation between curve checkpoints.
   * Rounds to the nearest 0.5 step.
   */
  private interpolate(
    cropDay: number,
    checkpoints: CurveCheckpoint[],
    defaultVal: number,
  ): number {
    if (!checkpoints || checkpoints.length === 0) {
      return defaultVal;
    }

    const sorted = [...checkpoints].sort((a, b) => a.cropDay - b.cropDay);

    if (cropDay <= sorted[0].cropDay) {
      return this.safeTargetValue(sorted[0]);
    }

    if (cropDay >= sorted[sorted.length - 1].cropDay) {
      return this.safeTargetValue(sorted[sorted.length - 1]);
    }

    let lower = sorted[0];
    let upper = sorted[sorted.length - 1];

    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].cropDay <= cropDay && cropDay <= sorted[i + 1].cropDay) {
        lower = sorted[i];
        upper = sorted[i + 1];
        break;
      }
    }

    if (lower.cropDay === upper.cropDay) {
      return this.safeTargetValue(lower);
    }

    const d1 = lower.cropDay;
    const d2 = upper.cropDay;
    const v1 = this.safeTargetValue(lower);
    const v2 = this.safeTargetValue(upper);

    const interpolatedValue = v1 + ((cropDay - d1) / (d2 - d1)) * (v2 - v1);

    return Math.round(interpolatedValue * 2) / 2;
  }

  /**
   * Fallback Bio-safety context returned when no active batch exists.
   */
  private getFallbackContext(): BatchContext {
    return {
      batchId: null,
      batch_id: null,
      cropDay: 1,
      crop_day: 1,
      targetTemp: 31.5,
      target_temp: 31.5,
      targetHumid: 80.0,
      target_humid: 80.0,
      tempOptimalMin: 28.0,
      temp_optimal_min: 28.0,
      tempOptimalMax: 35.0,
      temp_optimal_max: 35.0,
      humidityOptimalMin: 70.0,
      humidity_optimal_min: 70.0,
      humidityOptimalMax: 90.0,
      humidity_optimal_max: 90.0,
      lightStatus: 'OFF',
      light_status: 'OFF',
    };
  }

  /**
   * Creates a new crop batch for a mushroom house.
   * Enforces that only one active batch can exist per house.
   * Uses a pessimistic lock transaction to handle race conditions.
   */
  async createBatch(dto: CreateBatchDto): Promise<CropBatch> {
    const house = await this.mushroomHouseRepository.findOne({
      where: { id: dto.houseId },
    });
    if (!house) {
      throw new NotFoundException(
        `Mushroom house with ID '${dto.houseId}' not found.`,
      );
    }

    return await this.cropBatchRepository.manager.transaction(
      async (transactionalEntityManager) => {
        const activeBatch = await transactionalEntityManager.findOne(
          CropBatch,
          {
            where: { houseId: dto.houseId, status: 'ACTIVE' },
            lock: { mode: 'pessimistic_write' },
          },
        );

        if (activeBatch) {
          throw new ConflictException(
            `An active crop batch already exists for house '${dto.houseId}'.`,
          );
        }

        const newBatch = transactionalEntityManager.create(CropBatch, {
          ...dto,
          id: this.createBatchId(),
        });
        return await transactionalEntityManager.save(CropBatch, newBatch);
      },
    );
  }

  private createBatchId(): string {
    return `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  /**
   * Ends an existing crop batch by updating its status to COMPLETED or ABORTED.
   */
  async endBatch(
    id: string,
    status: 'COMPLETED' | 'ABORTED',
  ): Promise<CropBatch> {
    const batch = await this.cropBatchRepository.findOne({ where: { id } });
    if (!batch) {
      throw new NotFoundException(`Crop batch with ID '${id}' not found.`);
    }

    if (batch.status !== 'ACTIVE') {
      throw new ConflictException(
        `Cannot end batch '${id}' — current status is '${batch.status}'. Only ACTIVE batches can be ended.`,
      );
    }

    batch.status = status;
    return await this.cropBatchRepository.save(batch);
  }

  /**
   * Updates/replaces all checkpoints for an active crop batch within a database transaction.
   * Enforces that the batch must exist and have the 'ACTIVE' status.
   * Enforces a minimum configuration of 2 checkpoints per metricType (one on Day 1, one on Day N).
   */
  async updateBatchCheckpoints(
    id: string,
    dto: UpdateCheckpointsDto,
  ): Promise<CurveCheckpoint[]> {
    return await this.cropBatchRepository.manager.transaction(
      async (transactionalEntityManager) => {
        const txBatch = await transactionalEntityManager.findOne(CropBatch, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });

        if (!txBatch) {
          throw new NotFoundException(`Crop batch with ID '${id}' not found.`);
        }

        if (txBatch.status !== 'ACTIVE') {
          throw new BadRequestException(
            `Cannot update checkpoints for batch '${id}' — current status is '${txBatch.status}'. Only ACTIVE batches can have checkpoints updated.`,
          );
        }

        // Re-validate checkpoints list with locked batch configuration
        this.validateCheckpointsList(txBatch, dto.checkpoints);

        // Delete all existing checkpoints for this batch
        await transactionalEntityManager.delete(CurveCheckpoint, {
          batchId: id,
        });

        // Create new CurveCheckpoint entities
        const newCheckpoints = dto.checkpoints.map((cp) =>
          transactionalEntityManager.create(CurveCheckpoint, {
            batchId: id,
            metricType: cp.metricType,
            cropDay: cp.cropDay,
            targetValue: cp.targetValue,
          }),
        );

        // Save and return them
        return await transactionalEntityManager.save(
          CurveCheckpoint,
          newCheckpoints,
        );
      },
    );
  }

  private validateBounds(
    checkpoints: CheckpointDto[],
    totalDays: number,
  ): void {
    const outOfBounds = checkpoints.find(
      (c) => c.cropDay < 1 || c.cropDay > totalDays,
    );
    if (outOfBounds) {
      throw new BadRequestException(
        `Checkpoint day ${outOfBounds.cropDay} is invalid. It must be between 1 and ${totalDays}.`,
      );
    }
  }

  private validateDuplicates(checkpoints: CheckpointDto[], type: string): void {
    const days = checkpoints.map((c) => c.cropDay);
    const duplicateDay = days.find((day, index) => days.indexOf(day) !== index);
    if (duplicateDay) {
      throw new BadRequestException(
        `Duplicate cropDay ${duplicateDay} found in ${type} checkpoints.`,
      );
    }
  }

  private validateBoundaryDays(
    checkpoints: CheckpointDto[],
    totalDays: number,
    type: string,
  ): void {
    const hasDay1 = checkpoints.some((c) => c.cropDay === 1);
    const hasDayN = checkpoints.some((c) => c.cropDay === totalDays);
    if (checkpoints.length < 2 || !hasDay1 || !hasDayN) {
      throw new BadRequestException(
        `${type} checkpoints must contain at least 2 checkpoints (one for Day 1 and one for Day ${totalDays})`,
      );
    }
  }

  private validateCheckpointsList(
    batch: CropBatch,
    checkpoints: CheckpointDto[],
  ): void {
    const tempCheckpoints = checkpoints.filter(
      (c) => c.metricType === 'TEMPERATURE',
    );
    const humidityCheckpoints = checkpoints.filter(
      (c) => c.metricType === 'HUMIDITY',
    );

    this.validateBounds(checkpoints, batch.totalCropDays);

    this.validateDuplicates(tempCheckpoints, 'Temperature');
    this.validateDuplicates(humidityCheckpoints, 'Humidity');

    this.validateBoundaryDays(
      tempCheckpoints,
      batch.totalCropDays,
      'Temperature',
    );
    this.validateBoundaryDays(
      humidityCheckpoints,
      batch.totalCropDays,
      'Humidity',
    );
  }
}
