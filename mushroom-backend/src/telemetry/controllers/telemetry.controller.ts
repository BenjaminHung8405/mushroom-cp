import {
  Controller,
  Get,
  Param,
  Query,
  Sse,
  NotFoundException,
  MessageEvent,
} from '@nestjs/common';
import { Observable, of, concat, fromEvent, merge } from 'rxjs';
import { filter, map, takeUntil } from 'rxjs/operators';
import { Optional, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal } from '../../auth/auth.types';
import { AuthService } from '../../auth/auth.service';
import { TelemetryService } from '../services/telemetry.service';
import type { TelemetrySnapshot } from '../services/telemetry.service';
import {
  DeviceIdParamsDto,
  TelemetryHistoryQueryDto,
} from '../dto/telemetry.params.dto';

@Controller('devices')
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService, @Optional() private readonly authService?: AuthService) {}

  @Get(':id/telemetry')
  async getLatest(
    @Param() params: DeviceIdParamsDto,
  ): Promise<TelemetrySnapshot> {
    const snapshot = await this.telemetryService.getLatestTelemetry(params.id);
    if (!snapshot) {
      throw new NotFoundException(
        `No telemetry snapshot found for device ${params.id}`,
      );
    }
    return snapshot;
  }

  @Sse(':id/telemetry/stream')
  async streamTelemetry(
    @Param() params: DeviceIdParamsDto,
    @Req() request: Request & { authUser?: AuthPrincipal },
  ): Promise<Observable<MessageEvent>> {
    const initial = await this.telemetryService.getLatestTelemetry(params.id);

    // Route :id is MQTT deviceId — filter by deviceId, not houseId.
    const updates$ = this.telemetryService.telemetryUpdates$.pipe(
      filter((snapshot) => snapshot.deviceId === params.id),
      map((snapshot) => ({ data: snapshot })),
    );

    if (initial) {
      return concat(of({ data: initial } as MessageEvent), updates$).pipe(takeUntil(merge(this.revokedFor(request?.authUser), request ? fromEvent(request, 'close') : new Observable<never>(() => undefined))));
    }
    return updates$.pipe(takeUntil(merge(this.revokedFor(request?.authUser), request ? fromEvent(request, 'close') : new Observable<never>(() => undefined))));
  }

  private revokedFor(principal?: AuthPrincipal) { return principal && this.authService ? this.authService.userSessionsRevoked$.pipe(filter((userId) => userId === principal.id)) : new Observable<never>(() => undefined); }

  @Get(':id/telemetry/history')
  async getHistory(
    @Param() params: DeviceIdParamsDto,
    @Query() query: TelemetryHistoryQueryDto,
  ): Promise<TelemetrySnapshot[]> {
    const fromDate = new Date(query.from);
    const toDate = new Date(query.to);
    return await this.telemetryService.getTelemetryHistory(
      params.id,
      fromDate,
      toDate,
      query.bucket,
    );
  }
}
