import {
  IsEnum,
  IsInt,
  IsNumber,
  Min,
  Max,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum MetricType {
  TEMPERATURE = 'TEMPERATURE',
  HUMIDITY = 'HUMIDITY',
}

export class CheckpointDto {
  @IsEnum(MetricType, {
    message: 'metricType must be either TEMPERATURE or HUMIDITY',
  })
  metricType: MetricType;

  @IsInt()
  @Min(1)
  @Max(45)
  cropDay: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  targetValue: number;
}

export class UpdateCheckpointsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckpointDto)
  checkpoints: CheckpointDto[];
}
