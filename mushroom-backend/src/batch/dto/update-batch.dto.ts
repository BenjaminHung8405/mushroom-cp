import { IsEnum, IsNotEmpty } from 'class-validator';

export class UpdateBatchDto {
  @IsNotEmpty()
  @IsEnum(['COMPLETED', 'ABORTED'], {
    message: 'status must be either COMPLETED or ABORTED',
  })
  status: 'COMPLETED' | 'ABORTED';
}
