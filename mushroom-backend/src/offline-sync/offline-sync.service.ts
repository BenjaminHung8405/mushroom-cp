import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as mqtt from 'mqtt';
import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';
import {
  OFFLINE_TELEMETRY_STRUCT_BYTES,
  type OfflineSyncIngestionSummary,
  type OfflineTelemetryStruct,
} from './offline-sync.types';

@Injectable()
export class OfflineSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfflineSyncService.name);
  private readonly influxUrl = process.env.INFLUXDB_URL ?? '';
  private readonly influxToken = process.env.INFLUXDB_TOKEN ?? '';
  private readonly influxOrg = process.env.INFLUXDB_ORG ?? '';
  private readonly influxBucket = process.env.INFLUXDB_BUCKET ?? '';
  private readonly writeApi: WriteApi | null;
  private mqttClient: mqtt.MqttClient | null = null;

  constructor() {
    if (!this.influxUrl || !this.influxToken || !this.influxOrg || !this.influxBucket) {
      this.logger.warn('InfluxDB is not configured; offline sync ingestion is disabled.');
      this.writeApi = null;
      return;
    }
    this.writeApi = new InfluxDB({ url: this.influxUrl, token: this.influxToken })
      .getWriteApi(this.influxOrg, this.influxBucket, 'ms');
  }

  onModuleInit(): void {
    const url = process.env.OFFLINE_SYNC_MQTT_URL ?? process.env.MQTT_URL;
    if (!url) {
      this.logger.warn('OFFLINE_SYNC_MQTT_URL is not configured; devices/+/sync_burst listener is disabled.');
      return;
    }
    this.mqttClient = mqtt.connect(url, {
      username: process.env.OFFLINE_SYNC_MQTT_USERNAME,
      password: process.env.OFFLINE_SYNC_MQTT_PASSWORD,
      clientId: process.env.OFFLINE_SYNC_MQTT_CLIENT_ID ?? 'mushroom_offline_sync',
      reconnectPeriod: 5000,
    });
    this.mqttClient.on('connect', () => {
      this.mqttClient?.subscribe('devices/+/sync_burst', { qos: 1 }, (error) => {
        if (error) this.logger.error(`Failed to subscribe to offline sync topic: ${error.message}`);
        else this.logger.log('Subscribed to devices/+/sync_burst.');
      });
    });
    this.mqttClient.on('message', (topic: string, payload: Buffer) => {
      const match = /^devices\/([^/]+)\/sync_burst$/.exec(topic);
      if (!match) return;
      this.ingest(match[1], payload).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Offline MQTT ingest failed for ${match[1]}: ${message}`);
      });
    });
    this.mqttClient.on('error', (error) => this.logger.error(`Offline MQTT client error: ${error.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    this.mqttClient?.end(true);
    await this.writeApi?.close();
  }

  /**
   * Parses a concatenated array of little-endian OfflineTelemetryStruct records.
   * All Buffer reads are contained in try/catch so malformed firmware packets
   * are logged and rejected rather than crashing the Nest process.
   */
  parsePacket(payload: Buffer): OfflineTelemetryStruct[] {
    try {
      if (!Buffer.isBuffer(payload) || payload.length === 0) {
        throw new Error('payload is empty or not a Buffer');
      }
      if (payload.length % OFFLINE_TELEMETRY_STRUCT_BYTES !== 0) {
        throw new Error(`payload length ${payload.length} is not divisible by ${OFFLINE_TELEMETRY_STRUCT_BYTES}`);
      }

      const records: OfflineTelemetryStruct[] = [];
      for (let offset = 0; offset < payload.length; offset += OFFLINE_TELEMETRY_STRUCT_BYTES) {
        const bootCount = payload.readUInt32LE(offset);
        const deltaTimeS = payload.readUInt32LE(offset + 4);
        const temp = payload.readFloatLE(offset + 8);
        const humid = payload.readFloatLE(offset + 12);
        const mistState = payload.readUInt8(offset + 16);
        const lampState = payload.readUInt8(offset + 17);
        if (!Number.isFinite(temp) || !Number.isFinite(humid) ||
            (mistState !== 0 && mistState !== 1) || (lampState !== 0 && lampState !== 1)) {
          throw new Error(`invalid record at byte offset ${offset}`);
        }
        records.push({ bootCount, deltaTimeS, temp, humid, mistState: mistState === 1, lampState: lampState === 1 });
      }
      return records;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Rejected malformed offline binary packet: ${message}`);
      return [];
    }
  }

  async ingest(deviceId: string, payload: Buffer, serverTime = new Date()): Promise<OfflineSyncIngestionSummary> {
    const records = this.parsePacket(payload);
    if (records.length === 0) {
      return { deviceId, recordsReceived: 0, currentBootCount: null, trustedRecords: 0, degradedRecords: 0 };
    }

    const currentBootCount = Math.max(...records.map((record) => record.bootCount));
    const currentRecords = records.filter((record) => record.bootCount === currentBootCount);
    const currentAnchor = new Date(serverTime.getTime() - Math.max(...currentRecords.map((record) => record.deltaTimeS)) * 1000);
    const orphanSessions = [...new Set(records.filter((record) => record.bootCount < currentBootCount).map((record) => record.bootCount))]
      .sort((a, b) => a - b);
    const orphanAnchors = new Map<number, Date>();

    // Older boot sessions lack an absolute clock. Place each session before the
    // current session with its 30-second sample cadence plus a 30-second guard.
    let cursor = currentAnchor.getTime() - 30_000;
    for (const bootCount of orphanSessions.reverse()) {
      const sessionRecords = records.filter((record) => record.bootCount === bootCount);
      const maxDelta = Math.max(...sessionRecords.map((record) => record.deltaTimeS));
      const anchor = new Date(cursor - maxDelta * 1000);
      orphanAnchors.set(bootCount, anchor);
      cursor = anchor.getTime() - 30_000;
    }

    let trustedRecords = 0;
    let degradedRecords = 0;
    try {
      for (const record of records) {
        const trusted = record.bootCount === currentBootCount;
        const timestamp = trusted
          ? new Date(serverTime.getTime() - record.deltaTimeS * 1000)
          : new Date((orphanAnchors.get(record.bootCount) as Date).getTime() + record.deltaTimeS * 1000);
        this.writeRecord(deviceId, record, timestamp, trusted ? 'trusted' : 'degraded');
        if (trusted) trustedRecords += 1;
        else degradedRecords += 1;
      }
      await this.writeApi?.flush();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`InfluxDB write failed for ${deviceId}: ${message}`);
      throw error;
    }
    return { deviceId, recordsReceived: records.length, currentBootCount, trustedRecords, degradedRecords };
  }

  private writeRecord(deviceId: string, record: OfflineTelemetryStruct, timestamp: Date,
                      dataQuality: 'trusted' | 'degraded'): void {
    if (!this.writeApi) return;
    const base = (measurement: string) => new Point(measurement)
      .tag('device_id', deviceId)
      .tag('data_quality', dataQuality)
      .tag('boot_count', String(record.bootCount))
      .timestamp(timestamp);

    this.writeApi.writePoint(base('environment_telemetry')
      .floatField('temperature_c', record.temp)
      .floatField('humidity_percent', record.humid));
    this.writeApi.writePoint(base('actuator_events')
      .booleanField('mist_state', record.mistState)
      .booleanField('lamp_state', record.lampState));
    this.writeApi.writePoint(base('system_status')
      .uintField('boot_count', record.bootCount)
      .uintField('delta_time_s', record.deltaTimeS));
  }
}
