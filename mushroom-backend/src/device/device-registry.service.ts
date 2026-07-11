import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from './entities/device.entity';

export interface DeviceRecord {
  deviceId: string;
  houseId: string;
  enabled: boolean;
  displayName: string | null;
  mqttUsername: string;
  lastSeenAt: Date | null;
}

/**
 * In-memory device registry for MQTT hot path.
 * Bootstrap loads all devices once; per-message path is O(1) Map lookup only.
 * DB is touched on cache-miss / admin refresh — never on every 5s telemetry packet.
 */
@Injectable()
export class DeviceRegistryService implements OnModuleInit {
  private readonly logger = new Logger(DeviceRegistryService.name);
  private readonly cache = new Map<string, DeviceRecord>();
  private readonly inflightMiss = new Map<string, Promise<DeviceRecord | null>>();

  constructor(
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadAll();
  }

  async loadAll(): Promise<void> {
    const rows = await this.deviceRepo.find();
    this.cache.clear();
    for (const row of rows) {
      this.cache.set(row.deviceId, this.toRecord(row));
    }
    this.logger.log(
      `Device registry loaded: ${this.cache.size} device(s) in memory.`,
    );
  }

  /**
   * Sync hot-path lookup. Returns undefined if unknown (caller may trigger refreshOne).
   */
  get(deviceId: string): DeviceRecord | undefined {
    return this.cache.get(deviceId);
  }

  getEnabled(deviceId: string): DeviceRecord | undefined {
    const record = this.cache.get(deviceId);
    if (!record || !record.enabled) {
      return undefined;
    }
    return record;
  }

  /**
   * Cache-miss path: single-flight DB lookup, then populate cache.
   */
  async refreshOne(deviceId: string): Promise<DeviceRecord | null> {
    const existing = this.inflightMiss.get(deviceId);
    if (existing) {
      return existing;
    }

    const promise = this.deviceRepo
      .findOne({ where: { deviceId } })
      .then((row) => {
        if (!row) {
          this.cache.delete(deviceId);
          return null;
        }
        const record = this.toRecord(row);
        this.cache.set(deviceId, record);
        return record;
      })
      .finally(() => {
        this.inflightMiss.delete(deviceId);
      });

    this.inflightMiss.set(deviceId, promise);
    return promise;
  }

  upsertCache(record: DeviceRecord): void {
    this.cache.set(record.deviceId, record);
  }

  invalidate(deviceId: string): void {
    this.cache.delete(deviceId);
  }

  listCached(): DeviceRecord[] {
    return Array.from(this.cache.values());
  }

  async touchLastSeen(deviceId: string, at: Date): Promise<void> {
    const record = this.cache.get(deviceId);
    if (record) {
      record.lastSeenAt = at;
      this.cache.set(deviceId, record);
    }
    // Fire-and-forget DB update — never block telemetry pipeline.
    void this.deviceRepo
      .update({ deviceId }, { lastSeenAt: at })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Failed to persist last_seen_at for ${deviceId}: ${msg}`);
      });
  }

  private toRecord(row: Device): DeviceRecord {
    return {
      deviceId: row.deviceId,
      houseId: row.houseId,
      enabled: row.enabled,
      displayName: row.displayName,
      mqttUsername: row.mqttUsername,
      lastSeenAt: row.lastSeenAt,
    };
  }
}
