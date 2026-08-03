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
  UseGuards,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import type { Request } from 'express';
import { fromEvent, Observable } from 'rxjs';
import { filter, map, takeUntil } from 'rxjs/operators';
import { CreateTuningConfigurationDto } from '../dtos/create-tuning-configuration.dto';
import { TuningSseTicketService } from '../services/tuning-sse-ticket.service';
import { TuningSseTicketGuard } from '../guards/tuning-sse-ticket.guard';
import { Throttle } from '@nestjs/throttler';
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
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  async createTuningConfiguration(
    @Param('id') deviceId: string,
    @Body() dto: CreateTuningConfigurationDto,
  ): Promise<{ commandId: string; status: 'PENDING' }> {
    const pending =
      await this.tuningConfigurationService.createPendingCommandNonUser(
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
   * Returns the most recent persisted command state from the durable
   * configuration store, never MQTT retained state.
   */
  @Get(':id/tuning-configurations/latest')
  async getLatestTuningConfiguration(@Param('id') deviceId: string) {
    return this.tuningConfigurationService.getLatestByDeviceId(deviceId);
  }

  /**
   * Returns a bounded page of durable audit records.
   */
  @Get(':id/tuning-history')
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
   * Mints the short-lived credential accepted by the native EventSource route.
   * Non-user mode deliberately does not require a browser identity; the
   * ticket still keeps arbitrary URLs from opening a stream indefinitely.
   */
  @Post(':id/tuning-configurations/stream-ticket')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.CREATED)
  createTuningStreamTicket(
    @Param('id') deviceId: string,
  ): { ticket: string; expiresInSeconds: number } {
    return {
      ticket: this.tuningSseTicketService.createTicket('non-user', deviceId),
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
    return this.tuningConfigurationService.tuningSync$.pipe(
      filter((event) => event.deviceId === deviceId),
      map((event) => ({ data: event })),
      takeUntil(fromEvent(request, 'close')),
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
}
