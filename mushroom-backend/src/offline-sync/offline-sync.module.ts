import { Module } from '@nestjs/common';
import { OfflineSyncController } from './offline-sync.controller';
import { OfflineSyncService } from './offline-sync.service';
import { OfflineCanonicalNormalizerService } from '../influx/services/offline-canonical-normalizer.service';

@Module({
  controllers: [OfflineSyncController],
  providers: [OfflineSyncService, OfflineCanonicalNormalizerService],
  exports: [OfflineSyncService],
})
export class OfflineSyncModule {}
