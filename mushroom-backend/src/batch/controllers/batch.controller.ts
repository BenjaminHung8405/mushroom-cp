import { Controller, Post, Body, Patch, Param, Get } from '@nestjs/common';
import { BatchService } from '../services/batch.service';
import { CreateBatchDto } from '../dto/create-batch.dto';
import { UpdateBatchDto } from '../dto/update-batch.dto';
import { CropBatch } from '../entities/crop-batch.entity';

@Controller('batches')
export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  @Post()
  async create(@Body() createBatchDto: CreateBatchDto): Promise<CropBatch> {
    return await this.batchService.createBatch(createBatchDto);
  }

  @Patch(':id/end')
  async end(
    @Param('id') id: string,
    @Body() updateBatchDto: UpdateBatchDto,
  ): Promise<CropBatch> {
    return await this.batchService.endBatch(id, updateBatchDto.status);
  }

  @Get('active/:houseId')
  async getActive(
    @Param('houseId') houseId: string,
  ): Promise<CropBatch | null> {
    return await this.batchService.getActiveBatchByHouseId(houseId);
  }
}
