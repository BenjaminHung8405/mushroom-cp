import {
  IsString,
  Matches,
  MaxLength,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsIn,
} from 'class-validator';

export class DeviceIdParamsDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'id must be alphanumeric with underscores or hyphens',
  })
  @MaxLength(50)
  id: string;
}

export class TelemetryHistoryQueryDto {
  @IsNotEmpty()
  @IsISO8601({ strict: true })
  from: string;

  @IsNotEmpty()
  @IsISO8601({ strict: true })
  to: string;

  /**
   * Optional TimescaleDB interval. Server may coerce to a coarser bucket
   * for long ranges. Allowed: 1 minute | 5 minutes | 15 minutes | 1 hour | 1 day
   */
  @IsOptional()
  @IsIn(['1 minute', '5 minutes', '15 minutes', '1 hour', '1 day'])
  bucket?: string;
}
