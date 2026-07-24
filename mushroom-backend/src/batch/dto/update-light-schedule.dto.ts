import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, Max, Min, ValidateNested } from 'class-validator';

export class LightScheduleBlockDto {
  @IsInt()
  @Min(1)
  @Max(45)
  startDay: number;

  @IsInt()
  @Min(1)
  @Max(45)
  endDay: number;

  @IsIn(['ON', 'OFF'])
  status: 'ON' | 'OFF';
}

export class UpdateLightScheduleDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => LightScheduleBlockDto)
  blocks: LightScheduleBlockDto[];
}
