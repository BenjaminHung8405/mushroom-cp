import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  Max,
  IsOptional,
  IsNumber,
  IsBoolean,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateBatchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  houseId: string;

  @IsString()
  @IsNotEmpty()
  profileName: string;

  @IsInt()
  @Min(10)
  @Max(45)
  totalCropDays: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(45)
  spawnRunningEndDay?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(60)
  tempOptimalMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(60)
  tempOptimalMax?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  humidityOptimalMin?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  humidityOptimalMax?: number;

  @IsOptional()
  @IsBoolean()
  thermalShockProtection?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/, {
    message: 'thermalShockStart must be in HH:MM:SS format',
  })
  thermalShockStart?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/, {
    message: 'thermalShockEnd must be in HH:MM:SS format',
  })
  thermalShockEnd?: string;
}
