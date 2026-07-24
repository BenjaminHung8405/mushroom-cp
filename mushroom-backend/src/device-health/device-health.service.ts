import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Subject } from 'rxjs';
import type { DeviceRecord } from '../device/device-registry.service';

export enum HealthState {
  ONLINE_ACTIVE = 'ONLINE_ACTIVE',
  DEGRADED_LATENCY = 'DEGRADED_LATENCY',
  SENSOR_FAULT = 'SENSOR_FAULT',
  OFFLINE = 'OFFLINE',
  UNKNOWN = 'UNKNOWN',
}

export interface DeviceHealthEvent {
  deviceId: string;
  houseId: string;
  status: 'online' | 'offline';
  health: HealthState;
  lastTelemetryAt: string | null;
  receivedAt: string;
  /** @deprecated Prefer receivedAt. Kept for existing SSE consumers. */
  timestamp: string;
}

interface DeviceRuntimeCache {
  record: Pick<DeviceRecord, 'deviceId' | 'houseId'>;
  isMqttOnline: boolean;
  lastLivenessAt: Date | null;
  lastTelemetryAt: Date | null;
  bootGraceUntil: Date | null;
  currentHealth: HealthState;
}

const ACTIVE_MS = 45_000;
const FAULT_MS = 120_000;
const EVALUATION_INTERVAL_MS = 1_000;
const DEFAULT_CACHE_CAP = 256;

@Injectable()
export class DeviceHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeviceHealthService.name);
  private readonly cache = new Map<string, DeviceRuntimeCache>();
  private readonly maxEntries = this.readCacheCap();
  private scheduler: NodeJS.Timeout | null = null;
  readonly healthChanges$ = new Subject<DeviceHealthEvent>();

  onModuleInit(): void {
    this.scheduler = setInterval(
      () => this.evaluateGlobalHealthStates(),
      EVALUATION_INTERVAL_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.scheduler) clearInterval(this.scheduler);
    this.scheduler = null;
    this.healthChanges$.complete();
  }

  handleTelemetryReceived(
    record: DeviceRecord,
    receivedAt = new Date(),
  ): DeviceHealthEvent | null {
    const cache = this.getOrCreate(record, receivedAt);
    if (!cache) return null;
    cache.isMqttOnline = true;
    cache.lastLivenessAt = receivedAt;
    cache.lastTelemetryAt = receivedAt;
    cache.bootGraceUntil = null;
    return this.transition(cache, HealthState.ONLINE_ACTIVE, receivedAt);
  }

  handleLwtStatus(
    record: DeviceRecord,
    status: 'online' | 'offline',
    receivedAt = new Date(),
  ): DeviceHealthEvent | null {
    const cache = this.getOrCreate(record, receivedAt);
    if (!cache) return null;

    if (status === 'offline') {
      cache.isMqttOnline = false;
      cache.bootGraceUntil = null;
      return this.transition(cache, HealthState.OFFLINE, receivedAt);
    }

    cache.isMqttOnline = true;
    cache.lastLivenessAt = receivedAt;
    // An online retained/LWT status can arrive before the first real telemetry.
    // Use a fresh baseline for one boot grace window; never reuse stale pre-boot data.
    cache.lastTelemetryAt = receivedAt;
    cache.bootGraceUntil = new Date(receivedAt.getTime() + ACTIVE_MS);
    return this.transition(cache, HealthState.ONLINE_ACTIVE, receivedAt);
  }

  /** A valid MQTT heartbeat proves transport liveness but not sensor health. */
  handleHeartbeatReceived(
    record: DeviceRecord,
    receivedAt = new Date(),
  ): DeviceHealthEvent | null {
    const cache = this.getOrCreate(record, receivedAt);
    if (!cache) return null;
    cache.isMqttOnline = true;
    cache.lastLivenessAt = receivedAt;
    cache.bootGraceUntil = null;
    return this.transition(cache, this.calculateHealth(cache, receivedAt), receivedAt);
  }

  getHealth(deviceId: string): HealthState {
    return this.cache.get(deviceId)?.currentHealth ?? HealthState.UNKNOWN;
  }

  isCommandAllowed(deviceId: string): boolean {
    const health = this.getHealth(deviceId);
    return (
      health === HealthState.ONLINE_ACTIVE ||
      health === HealthState.DEGRADED_LATENCY
    );
  }

  remove(deviceId: string): void {
    this.cache.delete(deviceId);
  }

  /** Called by the scheduler and intentionally only iterates RAM. */
  evaluateGlobalHealthStates(now = new Date()): void {
    for (const cache of this.cache.values()) {
      if (!cache.isMqttOnline) continue;
      const health = this.calculateHealth(cache, now);
      this.transition(cache, health, now);
    }
  }

  private calculateHealth(cache: DeviceRuntimeCache, now: Date): HealthState {
    if (cache.bootGraceUntil && now < cache.bootGraceUntil)
      return HealthState.ONLINE_ACTIVE;
    const liveness = cache.lastLivenessAt;
    // Only retained status/LWT changes ONLINE/OFFLINE. Missing heartbeats make
    // an online device degraded/faulted, never silently override LWT state.
    if (!liveness || now.getTime() - liveness.getTime() > FAULT_MS)
      return HealthState.SENSOR_FAULT;
    const sensorBaseline = cache.lastTelemetryAt;
    if (!sensorBaseline || now.getTime() - sensorBaseline.getTime() > FAULT_MS)
      return HealthState.SENSOR_FAULT;
    if (now.getTime() - liveness.getTime() > ACTIVE_MS)
      return HealthState.DEGRADED_LATENCY;
    return HealthState.ONLINE_ACTIVE;
  }

  private getOrCreate(
    record: DeviceRecord,
    now: Date,
  ): DeviceRuntimeCache | null {
    if (!record.enabled) return null;
    const existing = this.cache.get(record.deviceId);
    if (existing) {
      existing.record = { deviceId: record.deviceId, houseId: record.houseId };
      return existing;
    }
    if (this.cache.size >= this.maxEntries) {
      this.logger.error(
        `Health runtime cache capacity (${this.maxEntries}) reached; dropping '${record.deviceId}'.`,
      );
      return null;
    }
    const cache: DeviceRuntimeCache = {
      record: { deviceId: record.deviceId, houseId: record.houseId },
      isMqttOnline: false,
      lastLivenessAt: now,
      lastTelemetryAt: now,
      bootGraceUntil: null,
      currentHealth: HealthState.UNKNOWN,
    };
    this.cache.set(record.deviceId, cache);
    return cache;
  }

  private transition(
    cache: DeviceRuntimeCache,
    health: HealthState,
    at: Date,
  ): DeviceHealthEvent | null {
    if (cache.currentHealth === health) return null;
    cache.currentHealth = health;
    const event: DeviceHealthEvent = {
      deviceId: cache.record.deviceId,
      houseId: cache.record.houseId,
      status: health === HealthState.OFFLINE ? 'offline' : 'online',
      health,
      lastTelemetryAt: cache.lastTelemetryAt?.toISOString() ?? null,
      receivedAt: at.toISOString(),
      timestamp: at.toISOString(),
    };
    this.logger.log(`[HEALTH] Device ${event.deviceId} shifted to ${health}`);
    this.healthChanges$.next(event);
    return event;
  }

  private readCacheCap(): number {
    const value = Number.parseInt(
      process.env.DEVICE_HEALTH_CACHE_CAP ?? '',
      10,
    );
    return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_CACHE_CAP;
  }
}
