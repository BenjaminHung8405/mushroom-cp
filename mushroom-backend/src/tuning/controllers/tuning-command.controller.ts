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
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Request } from 'express';
import { fromEvent, Observable } from 'rxjs';
import { filter, map, takeUntil } from 'rxjs/operators';
import { CreateTuningConfigurationDto } from '../dtos/create-tuning-configuration.dto';
import { DeviceOwnershipGuard } from '../guards/device-ownership.guard';
import { TuningSseTicketGuard } from '../guards/tuning-sse-ticket.guard';
import {
  JwtAuthGuard,
  type JwtAuthenticatedRequest,
} from '../guards/jwt-auth.guard';
import { TuningSseTicketService } from '../services/tuning-sse-ticket.service';
import {
  MAX_TUNING_HISTORY_OFFSET,
  TuningConfigurationService,
} from '../services/tuning-configuration.service';

@Controller('devices')
export class TuningCommandController {
  constructor(
    private readonly tuningConfigurationService: TuningConfigurationService,
    private readonly tuningSseTicketService: TuningSseTicketService,
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
    const ownerUserId = request.user!.sub;

    // The service repeats the ownership check inside its write transaction.
    // This closes the interval between DeviceOwnershipGuard and persistence.
    const pending =
      await this.tuningConfigurationService.createPendingCommandByOwner(
        ownerUserId,
        actor,
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
      this.parsePagination(
        offset,
        0,
        0,
        MAX_TUNING_HISTORY_OFFSET,
        'offset',
        false,
      ),
    );
  }

  /**
   * Mints the only credential accepted by the native EventSource route. The
   * bearer JWT stays in the authenticated POST request and is never placed in
   * a URL. Ownership is checked before a ticket can be issued.
   */
  @Post(':id/tuning-configurations/stream-ticket')
  @UseGuards(JwtAuthGuard, DeviceOwnershipGuard)
  @HttpCode(HttpStatus.CREATED)
  createTuningStreamTicket(
    @Param('id') deviceId: string,
    @Req() request: JwtAuthenticatedRequest,
  ): { ticket: string; expiresInSeconds: number } {
    return {
      ticket: this.tuningSseTicketService.createTicket(
        request.user!.sub,
        deviceId,
      ),
      expiresInSeconds: 30,
    };
  }

  /**
   * Streams durable configuration state changes via Server-Sent Events (SSE).
   * Native EventSource authenticates with a short-lived, one-time opaque
   * ticket bound to this device. The shared source is strictly filtered to
   * prevent cross-device broadcasts and unsubscribes on disconnect.
   */
  @Sse(':id/tuning-configurations/stream')
  @UseGuards(TuningSseTicketGuard)
  streamTuningConfigurations(
    @Param('id') deviceId: string,
    @Req() request: Request,
  ): Observable<MessageEvent> {
    return this.tuningConfigurationService.tuningSync$.pipe(
      filter((event) => event.deviceId === deviceId),
      map((event) => ({ data: event })),
      takeUntil(fromEvent(request, 'close')),
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

  private parsePagination(
    value: unknown,
    defaultValue: number,
    minimum: number,
    maximum: number,
    fieldName: 'limit' | 'offset',
    clamp = true,
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

    if (parsed > maximum && !clamp) {
      throw new BadRequestException(
        `${fieldName} must be between ${minimum} and ${maximum}.`,
      );
    }

    // The controller caps client input before it can reach the repository.
    // A zero limit is normalized to one rather than relying on ORM-specific
    // take(0) behaviour, which may be interpreted as an unbounded query.
    return Math.max(minimum, Math.min(parsed, maximum));
  }
}
