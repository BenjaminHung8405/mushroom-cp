import { Controller, Post, Body, Patch, Param, Get, Put, UseGuards, Logger } from '@nestjs/common';
import { BatchService } from '../services/batch.service';
import { CreateBatchDto } from '../dto/create-batch.dto';
import { UpdateBatchDto } from '../dto/update-batch.dto';
import { CropBatch } from '../entities/crop-batch.entity';
import { ActiveBatchResponseDto } from '../dto/active-batch-response.dto';
import { UpdateCheckpointsDto } from '../dto/update-checkpoints.dto';
import { CurveCheckpoint } from '../entities/curve-checkpoint.entity';
import { CheckpointOwnerGuard } from '../guards/checkpoint-owner.guard';

import { BatchIdParamsDto, HouseIdParamsDto } from '../dto/batch.params.dto';

@Controller('batches')
export class BatchController {
  private readonly logger = new Logger(BatchController.name);

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
    return await this.batchService.getActiveBatchStatusByHouseId(
      params.houseId,
    );
  }

  @Put(':id/checkpoints')
  @UseGuards(CheckpointOwnerGuard)
  async updateCheckpoints(
    @Param() params: BatchIdParamsDto,
    @Body() updateCheckpointsDto: UpdateCheckpointsDto,
  ): Promise<CurveCheckpoint[]> {
    this.logger.log(`Request to update checkpoints for batch '${params.id}'`);
    return await this.batchService.updateBatchCheckpoints(
      params.id,
      updateCheckpointsDto,
    );
  }
}
