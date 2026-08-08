import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class ListDevicesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

export class CreateDeviceDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]{3,50}$/, {
    message:
      'deviceId must be 3-50 alphanumeric characters, hyphens or underscores',
  })
  deviceId!: string;

  @IsString()
  @Matches(/^[a-z0-9_-]{3,50}$/, {
    message: 'houseId must be a valid house ID',
  })
  houseId!: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  displayName?: string;
}

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_-]{3,50}$/)
  houseId?: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  displayName?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
