import { Body, Controller, Get, Param, Post, Query, Req, UseGuards, BadRequestException } from '@nestjs/common';
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
      request.tuningPrincipal!,
      deviceId,
      this.pagination(limit, 'limit', 1, 100),
      this.pagination(offset, 'offset', 0, Number.MAX_SAFE_INTEGER),
    );
  }

  private pagination(value: string | undefined, fieldName: string, min: number, max: number): number | undefined {
    if (value === undefined) return undefined;  // absent → let service use default
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException(`${fieldName} must be a non-negative integer`);
    }
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < min || n > max) {
      throw new BadRequestException(`${fieldName} must be between ${min} and ${max}`);
    }
    return n;
  }
}
