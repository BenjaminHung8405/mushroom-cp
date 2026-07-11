import {
  Controller,
  Get,
  Param,
  Query,
  Sse,
  NotFoundException,
  MessageEvent,
} from '@nestjs/common';
import { Observable, of, concat } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { TelemetryService } from '../services/telemetry.service';
import type { TelemetrySnapshot } from '../services/telemetry.service';
import {
  DeviceIdParamsDto,
  TelemetryHistoryQueryDto,
} from '../dto/telemetry.params.dto';

@Controller('devices')
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  @Get(':id/telemetry')
  getLatest(@Param() params: DeviceIdParamsDto): TelemetrySnapshot {
    const snapshot = this.telemetryService.getLatestTelemetry(params.id);
    if (!snapshot) {
      throw new NotFoundException(
        `No telemetry snapshot found for device ${params.id}`,
      );
    }
    return snapshot;
  }

  @Sse(':id/telemetry/stream')
  streamTelemetry(
    @Param() params: DeviceIdParamsDto,
  ): Observable<MessageEvent> {
    const initial = this.telemetryService.getLatestTelemetry(params.id);

    // Route :id is MQTT deviceId — filter by deviceId, not houseId.
    const updates$ = this.telemetryService.telemetryUpdates$.pipe(
      filter((snapshot) => snapshot.deviceId === params.id),
      map((snapshot) => ({ data: snapshot })),
    );

    if (initial) {
      return concat(of({ data: initial } as MessageEvent), updates$);
    }
    return updates$;
  }

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
