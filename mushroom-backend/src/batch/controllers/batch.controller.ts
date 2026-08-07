import {
  Controller,
  Post,
  Body,
  Patch,
  Param,
  Get,
  Put,
  Logger,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { BatchService } from '../services/batch.service';
import { CreateBatchDto } from '../dto/create-batch.dto';
import { UpdateBatchDto } from '../dto/update-batch.dto';
import { CropBatch } from '../entities/crop-batch.entity';
import { ActiveBatchResponseDto } from '../dto/active-batch-response.dto';
import { UpdateCheckpointsDto } from '../dto/update-checkpoints.dto';
import { CurveCheckpoint } from '../entities/curve-checkpoint.entity';
import { UpdateLightScheduleDto } from '../dto/update-light-schedule.dto';
import { LightScheduleBlock } from '../entities/light-schedule-block.entity';

import { BatchIdParamsDto, HouseIdParamsDto } from '../dto/batch.params.dto';
import { Throttle } from '@nestjs/throttler';
import type { AuthPrincipal } from '../../auth/auth.types';

@Controller('batches')
export class BatchController {
  private readonly logger = new Logger(BatchController.name);

  constructor(private readonly batchService: BatchService) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async create(@Body() createBatchDto: CreateBatchDto, @Req() request?: Request & { authUser?: AuthPrincipal }): Promise<CropBatch> {
    return request?.authUser ? this.batchService.createBatchForPrincipal(request.authUser, createBatchDto) : this.batchService.createBatch(createBatchDto);
  }

  @Patch(':id/end')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async end(
    @Param() params: BatchIdParamsDto,
    @Body() updateBatchDto: UpdateBatchDto,
    @Req() request?: Request & { authUser?: AuthPrincipal },
  ): Promise<CropBatch> {
    return request?.authUser ? this.batchService.endBatchForPrincipal(request.authUser, params.id, updateBatchDto.status) : this.batchService.endBatch(params.id, updateBatchDto.status);
  }

  @Get('active/:houseId')
  async getActive(
    @Param() params: HouseIdParamsDto,
    @Req() request?: Request & { authUser?: AuthPrincipal },
  ): Promise<ActiveBatchResponseDto | null> {
    return request?.authUser ? this.batchService.getActiveBatchStatusForPrincipal(request.authUser, params.houseId) : this.batchService.getActiveBatchStatusByHouseId(params.houseId);
  }

  @Put(':id/checkpoints')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async updateCheckpoints(
    @Param() params: BatchIdParamsDto,
    @Body() updateCheckpointsDto: UpdateCheckpointsDto,
    @Req() request?: Request & { authUser?: AuthPrincipal },
  ): Promise<CurveCheckpoint[]> {
    this.logger.log(`Request to update checkpoints for batch '${params.id}'`);
    return request?.authUser ? this.batchService.updateBatchCheckpointsForPrincipal(request.authUser, params.id, updateCheckpointsDto) : this.batchService.updateBatchCheckpoints(params.id, updateCheckpointsDto);
  }

  @Get(':id/light-schedule')
  async getLightSchedule(
    @Param() params: BatchIdParamsDto,
    @Req() request?: Request & { authUser?: AuthPrincipal },
  ): Promise<LightScheduleBlock[]> {
    return request?.authUser ? this.batchService.getBatchLightScheduleForPrincipal(request.authUser, params.id) : this.batchService.getBatchLightSchedule(params.id);
  }

  @Put(':id/light-schedule')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async updateLightSchedule(
    @Param() params: BatchIdParamsDto,
    @Body() dto: UpdateLightScheduleDto,
    @Req() request?: Request & { authUser?: AuthPrincipal },
  ): Promise<LightScheduleBlock[]> {
    return request?.authUser ? this.batchService.updateBatchLightScheduleForPrincipal(request.authUser, params.id, dto.blocks) : this.batchService.updateBatchLightSchedule(params.id, dto.blocks);
  }
}
