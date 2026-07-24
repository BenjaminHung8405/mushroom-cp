import { Expose, Type } from 'class-transformer';
import { CropBatch } from '../entities/crop-batch.entity';
import { MetricType } from './update-checkpoints.dto';

export class LightScheduleBlockResponseDto {
  @Expose()
  startDay: number;

  @Expose()
  endDay: number;

  @Expose()
  status: 'ON' | 'OFF';
}

export class CheckpointResponseDto {
  @Expose()
  id: string;

  @Expose()
  batchId: string;

  @Expose()
  metricType: MetricType;

  @Expose()
  cropDay: number;

  @Expose()
  targetValue: number;
}

export class ActiveBatchResponseDto extends CropBatch {
  @Expose()
  cropDay: number;

  @Expose()
  crop_day: number;

  @Expose()
  @Type(() => CheckpointResponseDto)
  checkpoints: CheckpointResponseDto[];

  @Expose()
  @Type(() => LightScheduleBlockResponseDto)
  lightSchedule: LightScheduleBlockResponseDto[];
}
