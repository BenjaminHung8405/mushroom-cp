import {
  IsString,
  Matches,
  MaxLength,
  IsISO8601,
  IsNotEmpty,
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
}
