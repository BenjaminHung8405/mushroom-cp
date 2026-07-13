import { CropBatch } from '../entities/crop-batch.entity';

export class ActiveBatchResponseDto extends CropBatch {
  cropDay: number;
  crop_day: number;
}
