import { IsString, Matches, MaxLength } from 'class-validator';

export class BatchIdParamsDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'id must be alphanumeric with underscores or hyphens',
  })
  @MaxLength(50)
  id: string;
}

export class HouseIdParamsDto {
  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'houseId must be alphanumeric with underscores or hyphens',
  })
  @MaxLength(50)
  houseId: string;
}
