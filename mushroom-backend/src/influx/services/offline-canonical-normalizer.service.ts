import { Injectable } from '@nestjs/common';
import { Point, WriteApi } from '@influxdata/influxdb-client';
import type { OfflineSyncBurst } from '../../mqtt/offline-sync';

@Injectable()
export class OfflineCanonicalNormalizerService {
  writeBurst(
    writeApi: WriteApi,
    deviceId: string,
    burst: OfflineSyncBurst,
    receivedAt: Date,
  ): void {
    for (const record of burst.records) {
      const timestamp = new Date(
        (burst.sessionEndEpochMs ?? receivedAt.getTime()) -
          (burst.sessionLastDeltaS - record.deltaTimeS) * 1_000,
      );
      const valid =
        burst.schemaVersion === 2 &&
        record.tempTarget != null &&
        record.humidTarget != null &&
        record.configRevision != null;
      const point = new Point('controller_history')
        .tag('device_id', deviceId)
        .tag('data_quality', valid ? 'good' : 'degraded')
        .tag('provenance', 'offline_sync')
        .tag('publish_reason', 'reconnect')
        .timestamp(timestamp)
        .floatField('temperature_c', record.temp)
        .floatField('humidity_percent', record.humid)
        .booleanField('mist_state', record.mistState)
        .booleanField('lamp_state', record.lampState)
        .intField('telemetry_interval_sec', record.publishIntervalSec ?? 30)
        .uintField('boot_count', record.bootCount)
        .uintField('delta_time_s', record.deltaTimeS);
      if (valid)
        point
          .floatField('temp_target', record.tempTarget!)
          .floatField('humid_target', record.humidTarget!)
          .intField('config_revision', record.configRevision!);
      writeApi.writePoint(point);
    }
  }
}
