import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateHouseDto {
  @IsString()
  @Matches(/^[a-z0-9_-]{3,50}$/, {
    message:
      'id must be 3-50 lowercase alphanumeric characters, hyphens or underscores (e.g. house_b1)',
  })
  id!: string;

  @IsString()
  @Length(2, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  areaMeters?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  pillarCount?: number;
}

export class UpdateHouseDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 20)
  areaMeters?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  pillarCount?: number;
}
