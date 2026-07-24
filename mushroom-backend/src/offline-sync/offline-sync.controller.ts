import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Query,
} from '@nestjs/common';
import type { OfflineHistoryPoint } from './offline-sync.service';
import { OfflineSyncService } from './offline-sync.service';

/** Operational endpoint only; MQTT reception is owned by OfflineSyncService. */
@Controller('offline-sync')
export class OfflineSyncController {
  constructor(private readonly offlineSyncService: OfflineSyncService) {}

  @Get(':deviceId/status')
  getStatus(@Param('deviceId') deviceId: string): object {
    if (!deviceId)
      throw new HttpException('deviceId is required', HttpStatus.BAD_REQUEST);
    return {
      deviceId,
      recordSizeBytes: 18,
      topic: `devices/${deviceId}/sync_burst`,
    };
  }
  @Get(':deviceId/history')
  async getHistory(
    @Param('deviceId') deviceId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<OfflineHistoryPoint[]> {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    if (
      !deviceId ||
      Number.isNaN(fromDate.getTime()) ||
      Number.isNaN(toDate.getTime()) ||
      fromDate >= toDate
    ) {
      throw new BadRequestException(
        'deviceId, valid from, and valid to (from < to) are required',
      );
    }
    return this.offlineSyncService.getHistory(deviceId, fromDate, toDate);
  }
}
