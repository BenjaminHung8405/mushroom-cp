import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CreateTuningCommandDto } from '../dto/create-tuning-command.dto';
import { TuningPrincipalGuard } from '../guards/tuning-principal.guard';
import type { TuningRequest } from '../guards/tuning-principal.guard';
import { TuningConfigurationService } from '../services/tuning-configuration.service';

@Controller('tuning')
@UseGuards(TuningPrincipalGuard)
export class TuningController {
  constructor(private readonly tuningService: TuningConfigurationService) {}

  @Post('devices/:deviceId/commands')
  create(@Param('deviceId') deviceId: string, @Body() dto: CreateTuningCommandDto, @Req() request: TuningRequest) {
    // Principal is populated exclusively from an upstream verified JWT by the guard.
    return this.tuningService.createPendingCommand(request.tuningPrincipal!, deviceId, dto, dto.commandId);
  }

  @Get('devices/:deviceId/latest')
  latest(@Param('deviceId') deviceId: string, @Req() request: TuningRequest) {
    return this.tuningService.getLatestForPrincipal(request.tuningPrincipal!, deviceId);
  }

  @Get('devices/:deviceId/history')
  history(
    @Param('deviceId') deviceId: string,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Req() request: TuningRequest,
  ) {
    return this.tuningService.getHistoryForPrincipal(
      request.tuningPrincipal!, deviceId, this.pagination(limit), this.pagination(offset),
    );
  }

  private pagination(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value)) return Number.NaN;
    return Number(value);
  }
}
