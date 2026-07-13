import { Controller, Post, Body, Patch, Param, Get } from '@nestjs/common';
import { BatchService } from '../services/batch.service';
import { CreateBatchDto } from '../dto/create-batch.dto';
import { UpdateBatchDto } from '../dto/update-batch.dto';
import { CropBatch } from '../entities/crop-batch.entity';
import { ActiveBatchResponseDto } from '../dto/active-batch-response.dto';

import { BatchIdParamsDto, HouseIdParamsDto } from '../dto/batch.params.dto';

@Controller('batches')
export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  @Post()
  async create(@Body() createBatchDto: CreateBatchDto): Promise<CropBatch> {
    return await this.batchService.createBatch(createBatchDto);
  }

  @Patch(':id/end')
  async end(
    @Param() params: BatchIdParamsDto,
    @Body() updateBatchDto: UpdateBatchDto,
  ): Promise<CropBatch> {
    return await this.batchService.endBatch(params.id, updateBatchDto.status);
  }

  @Get('active/:houseId')
  async getActive(
    @Param() params: HouseIdParamsDto,
  ): Promise<ActiveBatchResponseDto | null> {
    return await this.batchService.getActiveBatchStatusByHouseId(params.houseId);
  }
}
