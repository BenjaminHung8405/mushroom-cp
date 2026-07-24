import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { Subject, Subscription } from 'rxjs';
import * as crypto from 'crypto';
import { Device } from '../../device/entities/device.entity';
import { MqttService, TuningReportedEvent } from '../../mqtt/mqtt.service';
import {
  DeviceTuningConfiguration,
  SyncStatus,
  TuningConfigSnapshot,
} from '../entities/device-tuning-configuration.entity';
import { TuningAuditLog } from '../entities/tuning-audit-log.entity';
import {
  LAMP_GAIN_SCALE_MAX,
  LAMP_GAIN_SCALE_MIN,
  MIN_THRESHOLD_GAP,
  MIST_GAIN_SCALE_MAX,
  MIST_GAIN_SCALE_MIN,
  MIST_OFF_THRESHOLD_MAX,
  MIST_OFF_THRESHOLD_MIN,
  MIST_ON_THRESHOLD_MAX,
  MIST_ON_THRESHOLD_MIN,
} from '../constants/tuning-contract.constants';

const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETAINED_CLEAR_MAX_ATTEMPTS = 5;
const RETAINED_CLEAR_RETRY_MS = 5_000;

/** Identity derived from a verified JWT; never accept this data from a DTO. */
export interface TuningPrincipal {
  subject: string;
  allowedHouseIds: readonly string[];
  isAdmin?: boolean;
}

export interface TuningSyncEvent {
  id: string;
  deviceId: string;
  commandId: string;
  revision: number;
  status: SyncStatus;
  config: TuningConfigSnapshot;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class TuningConfigurationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TuningConfigurationService.name);
  public readonly tuningSync$ = new Subject<TuningSyncEvent>();
  private tuningReportedSub?: Subscription;
  private retainedClearTimer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DeviceTuningConfiguration)
    private readonly configRepo: Repository<DeviceTuningConfiguration>,
    @InjectRepository(TuningAuditLog)
    private readonly auditRepo: Repository<TuningAuditLog>,
    @Inject(forwardRef(() => MqttService)) private readonly mqttService: MqttService,
  ) {}

  onModuleInit(): void {
    this.tuningReportedSub = this.mqttService.tuningReported$?.subscribe((event) => {
      void this.handleReportedAck(event).catch((error: unknown) => this.logError('Failed processing tuning ACK', error));
    });
    this.retainedClearTimer = setInterval(() => void this.retryRetainedClears(), RETAINED_CLEAR_RETRY_MS);
    this.retainedClearTimer.unref();
  }

  onModuleDestroy(): void {
    this.tuningReportedSub?.unsubscribe();
    if (this.retainedClearTimer) clearInterval(this.retainedClearTimer);
  }

  async getLatestByDeviceId(deviceId: string): Promise<DeviceTuningConfiguration | null> {
    return this.configRepo.findOne({ where: { deviceId: this.validDeviceId(deviceId) }, order: { createdAt: 'DESC' } });
  }

  async getTuningHistory(deviceId: string, limit?: number, offset?: number): Promise<{ items: TuningAuditLog[]; total: number; limit: number; offset: number }> {
    const parsedLimit = Number.isInteger(limit) && (limit as number) >= 1 ? Math.min(limit as number, 100) : 20;
    const parsedOffset = Number.isInteger(offset) && (offset as number) >= 0 ? offset as number : 0;
    const [items, total] = await this.auditRepo.findAndCount({
      where: { deviceId: this.validDeviceId(deviceId) }, order: { createdAt: 'DESC', id: 'DESC' }, take: parsedLimit, skip: parsedOffset,
    });
    return { items, total, limit: parsedLimit, offset: parsedOffset };
  }

  /** Persist first, publish immutable durable snapshot second. */
  async createPendingCommand(principal: TuningPrincipal, deviceId: string, config: TuningConfigSnapshot, commandId: string): Promise<DeviceTuningConfiguration> {
    this.validatePrincipal(principal);
    const normalizedDeviceId = this.validDeviceId(deviceId);
    this.validateCommandId(commandId);
    this.validateSnapshot(config);
    const pending = await this.createOrGetPending(principal, normalizedDeviceId, config, commandId);
    if (pending.publishedAt || pending.status !== SyncStatus.PENDING) return pending;
    return this.publishPending(pending, principal.subject);
  }

  private async createOrGetPending(principal: TuningPrincipal, deviceId: string, config: TuningConfigSnapshot, commandId: string): Promise<DeviceTuningConfiguration> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [deviceId]);
        const device = await manager.findOne(Device, { where: { deviceId } });
        this.assertDeviceAccess(device, principal, deviceId);
        const existing = await manager.findOne(DeviceTuningConfiguration, { where: { deviceId, commandId } });
        if (existing) {
          if (!this.sameSnapshot(existing.config, config)) throw new ConflictException('commandId is already bound to a different tuning configuration.');
          return existing;
        }
        const latest = await manager.findOne(DeviceTuningConfiguration, { where: { deviceId }, order: { createdAt: 'DESC' } });
        const configBefore = latest?.status === SyncStatus.IN_SYNC ? latest.config : null;
        const saved = await manager.save(DeviceTuningConfiguration, manager.create(DeviceTuningConfiguration, {
          id: crypto.randomUUID(), deviceId, commandId, revision: (latest?.revision ?? 0) + 1,
          status: SyncStatus.PENDING, config: { ...config }, publishedAt: null,
          retainedClearPending: false, retainedClearAttempts: 0, retainedClearNextAt: null,
        }));
        await this.writeAudit(manager, saved, principal.subject, 'api', 'CREATE_PENDING', configBefore, saved.config, 'Create pending tuning command', 'SUCCESS');
        return saved;
      });
    } catch (error: unknown) {
      if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException) throw error;
      if (this.isUniqueViolation(error)) {
        const existing = await this.configRepo.findOne({ where: { deviceId, commandId } });
        if (existing) {
          if (!this.sameSnapshot(existing.config, config)) throw new ConflictException('commandId is already bound to a different tuning configuration.');
          return existing;
        }
      }
      this.logError('Failed to persist pending tuning command', error);
      throw new InternalServerErrorException('Failed to create pending tuning command due to database error.');
    }
  }

  private async publishPending(config: DeviceTuningConfiguration, actor: string): Promise<DeviceTuningConfiguration> {
    try {
      await this.mqttService.publishTuningDesired(config.deviceId, config.commandId, config.config);
      config.publishedAt = new Date();
      const saved = await this.configRepo.save(config);
      this.emit(saved);
      return saved;
    } catch (error: unknown) {
      await this.markPublishFailure(config, actor, error);
      throw new InternalServerErrorException('Failed to publish tuning command to device.');
    }
  }

  private async markPublishFailure(config: DeviceTuningConfiguration, actor: string, error: unknown): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.update(DeviceTuningConfiguration, { id: config.id }, { status: SyncStatus.REJECTED, updatedAt: new Date() });
        await this.writeAudit(manager, config, actor, 'api', 'PUBLISH_FAILED', null, config.config, this.errorMessage(error), 'FAILED');
      });
      config.status = SyncStatus.REJECTED;
    } catch (auditError: unknown) {
      this.logError('Failed to durably record MQTT publish failure', auditError);
    }
  }

  async handleReportedAck(ack: TuningReportedEvent): Promise<{ updated: boolean; isLatest: boolean }> {
    if (!this.isValidAck(ack)) return { updated: false, isLatest: false };
    const result = { updated: false, isLatest: false };
    let event: TuningSyncEvent | null = null;
    try {
      await this.dataSource.transaction(async (manager) => {
        const config = await manager.findOne(DeviceTuningConfiguration, { where: { deviceId: ack.deviceId, commandId: ack.commandId }, lock: { mode: 'pessimistic_write' } });
        if (!config) { this.logger.warn(`SECURITY: unknown tuning ACK device='${ack.deviceId}' command='${ack.commandId}'.`); return; }
        const latest = await manager.findOne(DeviceTuningConfiguration, { where: { deviceId: ack.deviceId }, order: { createdAt: 'DESC' } });
        result.isLatest = latest?.id === config.id;
        if (config.status !== SyncStatus.PENDING) return;
        // Fail closed: ACCEPTED/DUPLICATE has no durability meaning unless persisted is true.
        const accepted = (ack.status === 'ACCEPTED' || ack.status === 'DUPLICATE') && ack.persisted === true;
        config.status = accepted ? SyncStatus.IN_SYNC : SyncStatus.REJECTED;
        if (accepted && result.isLatest) {
          config.retainedClearPending = true;
          config.retainedClearAttempts = 0;
          config.retainedClearNextAt = new Date();
        }
        config.updatedAt = new Date();
        await manager.save(DeviceTuningConfiguration, config);
        const before = await manager.findOne(DeviceTuningConfiguration, { where: { deviceId: ack.deviceId, status: SyncStatus.IN_SYNC, createdAt: LessThan(config.createdAt) }, order: { createdAt: 'DESC' } });
        await this.writeAudit(manager, config, 'device', 'mqtt', accepted ? 'SYNC_ACCEPTED' : 'SYNC_REJECTED', before?.config ?? null, config.config, accepted ? ack.reasonCode : (ack.persisted ? ack.reasonCode : 'PERSISTENCE_NOT_CONFIRMED'), accepted ? 'SUCCESS' : 'FAILED');
        result.updated = true;
        event = this.toEvent(config);
      });
    } catch (error: unknown) {
      this.logError(`Failed to handle tuning ACK for device '${ack.deviceId}'`, error);
      throw new InternalServerErrorException('Failed to process tuning acknowledgement due to database error.');
    }
    if (event) this.tuningSync$.next(event);
    if (result.updated && result.isLatest) await this.retryRetainedClears();
    return result;
  }

  /** Persistent outbox retry. A retained clear is never silently discarded. */
  async retryRetainedClears(): Promise<void> {
    const due = await this.configRepo.find({ where: { retainedClearPending: true }, order: { updatedAt: 'ASC' }, take: 20 });
    const now = Date.now();
    for (const candidate of due) {
      if (!candidate.retainedClearNextAt || candidate.retainedClearNextAt.getTime() <= now) {
        await this.clearRetainedIfStillCurrent(candidate.id);
      }
    }
  }

  private async clearRetainedIfStillCurrent(configurationId: string): Promise<void> {
    const config = await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(DeviceTuningConfiguration, { where: { id: configurationId }, lock: { mode: 'pessimistic_write' } });
      if (!locked?.retainedClearPending || locked.retainedClearAttempts >= RETAINED_CLEAR_MAX_ATTEMPTS) return null;
      const latest = await manager.findOne(DeviceTuningConfiguration, { where: { deviceId: locked.deviceId }, order: { createdAt: 'DESC' } });
      if (latest?.id !== locked.id || locked.status !== SyncStatus.IN_SYNC) {
        locked.retainedClearPending = false;
        await manager.save(DeviceTuningConfiguration, locked);
        return null;
      }
      return locked;
    });
    if (!config) return;
    try {
      await this.mqttService.clearTuningDesired(config.deviceId);
      await this.configRepo.update({ id: config.id, retainedClearPending: true }, { retainedClearPending: false, retainedClearNextAt: null });
    } catch (error: unknown) {
      const attempts = config.retainedClearAttempts + 1;
      const delay = RETAINED_CLEAR_RETRY_MS * 2 ** Math.min(attempts - 1, 4);
      await this.configRepo.update({ id: config.id }, { retainedClearAttempts: attempts, retainedClearNextAt: new Date(Date.now() + delay) });
      this.logger.warn(`Retained tuning clear retry ${attempts}/${RETAINED_CLEAR_MAX_ATTEMPTS} for '${config.deviceId}': ${this.errorMessage(error)}`);
    }
  }

  private validateSnapshot(config: TuningConfigSnapshot): void {
    if (!config || Object.values(config).some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new BadRequestException('All tuning parameters must be finite numbers.');
    this.inRange('lamp_gain_scale', config.lamp_gain_scale, LAMP_GAIN_SCALE_MIN, LAMP_GAIN_SCALE_MAX);
    this.inRange('mist_gain_scale', config.mist_gain_scale, MIST_GAIN_SCALE_MIN, MIST_GAIN_SCALE_MAX);
    this.inRange('mist_on_threshold', config.mist_on_threshold, MIST_ON_THRESHOLD_MIN, MIST_ON_THRESHOLD_MAX);
    this.inRange('mist_off_threshold', config.mist_off_threshold, MIST_OFF_THRESHOLD_MIN, MIST_OFF_THRESHOLD_MAX);
    if (config.mist_off_threshold >= config.mist_on_threshold - MIN_THRESHOLD_GAP) throw new BadRequestException('mist_off_threshold must be strictly less than mist_on_threshold with a minimum gap of 0.001.');
  }

  private assertDeviceAccess(device: Device | null, principal: TuningPrincipal, deviceId: string): void {
    if (!device) throw new NotFoundException(`Device '${deviceId}' not found.`);
    if (!device.enabled) throw new BadRequestException(`Device '${deviceId}' is disabled.`);
    if (!principal.isAdmin && !principal.allowedHouseIds.includes(device.houseId)) throw new ForbiddenException(`Not authorized to tune device '${deviceId}'.`);
  }

  private async writeAudit(manager: { create: Function; save: Function }, config: DeviceTuningConfiguration, actor: string, source: string, action: string, before: TuningConfigSnapshot | null, after: TuningConfigSnapshot | null, reason: string | null, result: string): Promise<void> {
    await manager.save(TuningAuditLog, manager.create(TuningAuditLog, { id: crypto.randomUUID(), configurationId: config.id, deviceId: config.deviceId, actor, source, action, rulesetVersion: null, kpiSnapshot: null, configBefore: before, configAfter: after, reason, result }));
  }

  private isValidAck(ack: TuningReportedEvent): boolean {
    return !!ack && typeof ack.deviceId === 'string' && ack.deviceId.trim().length > 0 && ack.deviceId.length <= 50 && typeof ack.commandId === 'string' && COMMAND_ID_PATTERN.test(ack.commandId) && (ack.status === 'ACCEPTED' || ack.status === 'DUPLICATE' || ack.status === 'REJECTED') && typeof ack.persisted === 'boolean';
  }
  private validDeviceId(value: string): string { if (typeof value !== 'string' || !value.trim() || value.length > 50) throw new BadRequestException('deviceId is required and must be under 50 characters.'); return value.trim(); }
  private validateCommandId(value: string): void { if (typeof value !== 'string' || !COMMAND_ID_PATTERN.test(value)) throw new BadRequestException('commandId must be a valid UUID.'); }
  private validatePrincipal(principal: TuningPrincipal): void { if (!principal || typeof principal.subject !== 'string' || !principal.subject.trim() || !Array.isArray(principal.allowedHouseIds)) throw new ForbiddenException('A verified tuning principal is required.'); }
  private inRange(name: string, value: number, min: number, max: number): void { if (value < min || value > max) throw new BadRequestException(`${name} must be between ${min.toFixed(2)} and ${max.toFixed(2)}.`); }
  private toEvent(config: DeviceTuningConfiguration): TuningSyncEvent { return { id: config.id, deviceId: config.deviceId, commandId: config.commandId, revision: config.revision, status: config.status, config: config.config, publishedAt: config.publishedAt?.toISOString() ?? null, createdAt: config.createdAt.toISOString(), updatedAt: config.updatedAt.toISOString() }; }
  private emit(config: DeviceTuningConfiguration): void { this.tuningSync$.next(this.toEvent(config)); }
  private sameSnapshot(left: TuningConfigSnapshot, right: TuningConfigSnapshot): boolean {
    return left.lamp_gain_scale === right.lamp_gain_scale && left.mist_gain_scale === right.mist_gain_scale && left.mist_on_threshold === right.mist_on_threshold && left.mist_off_threshold === right.mist_off_threshold;
  }
  private isUniqueViolation(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505'; }
  private errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Unknown error'; }
  private logError(message: string, error: unknown): void { this.logger.error(`${message}: ${this.errorMessage(error)}`); }
}
