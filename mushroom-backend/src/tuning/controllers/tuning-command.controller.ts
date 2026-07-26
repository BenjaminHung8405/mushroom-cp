import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CreateTuningConfigurationDto } from '../dtos/create-tuning-configuration.dto';
import { DeviceOwnershipGuard } from '../guards/device-ownership.guard';
import {
  JwtAuthGuard,
  type JwtAuthenticatedRequest,
} from '../guards/jwt-auth.guard';
import {
  TuningConfigurationService,
  type TuningPrincipal,
} from '../services/tuning-configuration.service';

@Controller('devices')
export class TuningCommandController {
  constructor(
    private readonly tuningConfigurationService: TuningConfigurationService,
  ) {}

  @Post(':id/tuning-configurations')
  @UseGuards(JwtAuthGuard, DeviceOwnershipGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async createTuningConfiguration(
    @Param('id') deviceId: string,
    @Body() dto: CreateTuningConfigurationDto,
    @Req() request: JwtAuthenticatedRequest,
  ): Promise<{ commandId: string; status: 'PENDING' }> {
    const actor = this.actorEmail(request);
    const pending = await this.tuningConfigurationService.createPendingCommand(
      this.actorPrincipal(actor),
      deviceId,
      dto.config,
      dto.commandId,
    );

    return {
      commandId: pending.commandId,
      status: 'PENDING',
    };
  }

  /**
   * Returns the most recent persisted command state. Authentication and
   * ownership are enforced by the route guards; the state itself must always
   * come from the durable configuration store, never MQTT retained state.
   */
  @Get(':id/tuning-configurations/latest')
  @UseGuards(JwtAuthGuard, DeviceOwnershipGuard)
  async getLatestTuningConfiguration(@Param('id') deviceId: string) {
    return this.tuningConfigurationService.getLatestByDeviceId(deviceId);
  }

  /**
   * Returns a bounded page of durable audit records. The guards run before
   * this method, so only the verified owner of the route device can read it.
   */
  @Get(':id/tuning-history')
  @UseGuards(JwtAuthGuard, DeviceOwnershipGuard)
  async getTuningHistory(
    @Param('id') deviceId: string,
    @Query('limit') limit: unknown,
    @Query('offset') offset: unknown,
  ) {
    return this.tuningConfigurationService.getTuningHistory(
      deviceId,
      this.parsePagination(limit, 20, 1, 100, 'limit'),
      this.parsePagination(offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset'),
    );
  }

  private actorEmail(request: JwtAuthenticatedRequest): string {
    // JwtAuthGuard guarantees a verified JWT subject; email, when present, is
    // exclusively a verified claim and is used as the durable audit actor.
    const actor = request.user?.email;
    if (!actor) {
      throw new UnauthorizedException(
        'JWT email is required for tuning commands.',
      );
    }

    return actor;
  }

  private actorPrincipal(actor: string): TuningPrincipal {
    // DeviceOwnershipGuard verifies ownership using the JWT subject before the
    // controller runs. The legacy service API needs this internal principal
    // shape; the verified email remains its durable audit actor.
    return { subject: actor, allowedHouseIds: [], isAdmin: true };
  }

  private parsePagination(
    value: unknown,
    defaultValue: number,
    minimum: number,
    maximum: number,
    fieldName: 'limit' | 'offset',
  ): number {
    if (value === undefined) {
      return defaultValue;
    }

    if (typeof value !== 'string' || !/^\d+$/u.test(value)) {
      throw new BadRequestException(
        `${fieldName} must be a non-negative integer.`,
      );
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new BadRequestException(
        `${fieldName} must be a non-negative integer.`,
      );
    }

    // The controller caps client input before it can reach the repository.
    // A zero limit is normalized to one rather than relying on ORM-specific
    // take(0) behaviour, which may be interpreted as an unbounded query.
    return Math.max(minimum, Math.min(parsed, maximum));
  }
}
