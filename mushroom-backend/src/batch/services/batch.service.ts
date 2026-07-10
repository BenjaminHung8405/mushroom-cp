import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { CropBatch } from '../entities/crop-batch.entity';
import { CurveCheckpoint } from '../entities/curve-checkpoint.entity';
import { LightScheduleBlock } from '../entities/light-schedule-block.entity';
import { MushroomHouse } from '../entities/mushroom-house.entity';
import { toZonedTime } from 'date-fns-tz';
import { CreateBatchDto } from '../dto/create-batch.dto';

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
  thermalShockProtection: boolean;
  thermal_shock_protection: boolean;
  thermalShockStart: string;
  thermal_shock_start: string;
  thermalShockEnd: string;
  thermal_shock_end: string;
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

    const diffMs = zonedNow.getTime() - zonedStart.getTime();
    let cropDay = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;

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
      thermalShockProtection: activeBatch.thermalShockProtection,
      thermal_shock_protection: activeBatch.thermalShockProtection,
      thermalShockStart: activeBatch.thermalShockStart,
      thermal_shock_start: activeBatch.thermalShockStart,
      thermalShockEnd: activeBatch.thermalShockEnd,
      thermal_shock_end: activeBatch.thermalShockEnd,
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
      thermalShockProtection: true,
      thermal_shock_protection: true,
      thermalShockStart: '11:00:00',
      thermal_shock_start: '11:00:00',
      thermalShockEnd: '13:30:00',
      thermal_shock_end: '13:30:00',
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

        const newBatch = transactionalEntityManager.create(CropBatch, dto);
        return await transactionalEntityManager.save(CropBatch, newBatch);
      },
    );
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

    batch.status = status;
    return await this.cropBatchRepository.save(batch);
  }
}
