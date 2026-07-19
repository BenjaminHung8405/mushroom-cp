import { Controller, Get, HttpException, HttpStatus, Param } from '@nestjs/common';
import { OfflineSyncService } from './offline-sync.service';

/** Operational endpoint only; MQTT reception is owned by OfflineSyncService. */
@Controller('offline-sync')
export class OfflineSyncController {
  constructor(private readonly offlineSyncService: OfflineSyncService) {}

  @Get(':deviceId/status')
  getStatus(@Param('deviceId') deviceId: string): object {
    if (!deviceId) throw new HttpException('deviceId is required', HttpStatus.BAD_REQUEST);
    return { deviceId, recordSizeBytes: 18, topic: `devices/${deviceId}/sync_burst` };
  }
}
