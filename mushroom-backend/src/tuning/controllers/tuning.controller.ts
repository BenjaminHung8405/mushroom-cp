import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
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
}
