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
  Optional,
  UseGuards,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Request } from 'express';
import { fromEvent, merge, Observable } from 'rxjs';
import { filter, map, takeUntil } from 'rxjs/operators';
import { CreateTuningConfigurationDto } from '../dtos/create-tuning-configuration.dto';
import { TuningSseTicketService } from '../services/tuning-sse-ticket.service';
import { TuningSseTicketGuard } from '../guards/tuning-sse-ticket.guard';
import { Throttle } from '@nestjs/throttler';
import {
  MAX_TUNING_HISTORY_OFFSET,
  TuningConfigurationService,
} from '../services/tuning-configuration.service';
import type { AuthPrincipal } from '../../auth/auth.types';
import { UserRole } from '../../auth/entities/user.entity';
import { AuthService } from '../../auth/auth.service';

@Controller('devices')
export class TuningCommandController {
  constructor(
    private readonly tuningConfigurationService: TuningConfigurationService,
    private readonly tuningSseTicketService: TuningSseTicketService,
    @Optional() private readonly authService?: AuthService,
  ) {}

  @Post(':id/tuning-configurations')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  async createTuningConfiguration(
    @Param('id') deviceId: string,
    @Body() dto: CreateTuningConfigurationDto,
    @Req() request: Request & { authUser?: AuthPrincipal },
  ): Promise<{ commandId: string; status: 'PENDING' }> {
    const principal = request?.authUser;
    const pending = principal
      ? await this.tuningConfigurationService.createPendingCommand(
          this.tuningPrincipal(principal), deviceId, dto.config, dto.commandId,
        )
      : await this.tuningConfigurationService.createPendingCommandNonUser(
          deviceId, dto.config, dto.commandId,
        );

    return {
      commandId: pending.commandId,
      status: 'PENDING',
    };
  }

  /**
   * Returns the most recent persisted command state from the durable
   * configuration store, never MQTT retained state.
   */
  @Get(':id/tuning-configurations/latest')
  async getLatestTuningConfiguration(@Param('id') deviceId: string, @Req() request?: Request & { authUser?: AuthPrincipal }) {
    return request?.authUser
      ? this.tuningConfigurationService.getLatestForPrincipal(this.tuningPrincipal(request.authUser), deviceId)
      : this.tuningConfigurationService.getLatestByDeviceId(deviceId);
  }

  /**
   * Returns a bounded page of durable audit records.
   */
  @Get(':id/tuning-history')
  async getTuningHistory(
    @Param('id') deviceId: string,
    @Query('limit') limit: unknown,
    @Query('offset') offset: unknown,
    @Req() request?: Request & { authUser?: AuthPrincipal },
  ) {
    const parsedLimit = this.parsePagination(limit, 20, 1, 100, 'limit');
    const parsedOffset = this.parsePagination(
        offset,
        0,
        0,
        MAX_TUNING_HISTORY_OFFSET,
        'offset',
        false,
      );
    return request?.authUser
      ? this.tuningConfigurationService.getHistoryForPrincipal(this.tuningPrincipal(request.authUser), deviceId, parsedLimit, parsedOffset)
      : this.tuningConfigurationService.getTuningHistory(deviceId, parsedLimit, parsedOffset);
  }

  /**
   * Mints the short-lived credential accepted by the native EventSource route.
   * Non-user mode deliberately does not require a browser identity; the
   * ticket still keeps arbitrary URLs from opening a stream indefinitely.
   */
  @Post(':id/tuning-configurations/stream-ticket')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  createTuningStreamTicket(
    @Param('id') deviceId: string,
    @Req() request?: Request & { authUser?: AuthPrincipal },
  ): { ticket: string; expiresInSeconds: number } {
    return {
      ticket: this.tuningSseTicketService.createTicket(request?.authUser?.sessionId ?? 'non-user', deviceId),
      expiresInSeconds: 30,
    };
  }

  /**
   * Streams durable configuration state changes via Server-Sent Events (SSE).
   * Native EventSource uses a short-lived, one-time opaque ticket bound to
   * this device. The shared source is strictly filtered to prevent
   * cross-device broadcasts and unsubscribes on disconnect.
   */
  @Sse(':id/tuning-configurations/stream')
  @UseGuards(TuningSseTicketGuard)
  streamTuningConfigurations(
    @Param('id') deviceId: string,
    @Req() request: Request,
  ): Observable<MessageEvent> {
    const principal = (request as Request & { authUser?: AuthPrincipal }).authUser;
    const closed$ = principal && this.authService
      ? merge(fromEvent(request, 'close'), this.authService.userSessionsRevoked$.pipe(filter((userId) => userId === principal.id)))
      : fromEvent(request, 'close');
    return this.tuningConfigurationService.tuningSync$.pipe(
      filter((event) => event.deviceId === deviceId),
      map((event) => ({ data: event })),
      takeUntil(closed$),
    );
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

  private tuningPrincipal(principal: AuthPrincipal) {
    return { subject: principal.id, allowedHouseIds: principal.houseIds, isAdmin: principal.role === UserRole.ADMIN };
  }
}
