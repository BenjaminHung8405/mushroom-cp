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
import { DataSource, EntityManager, LessThan, Repository } from 'typeorm';
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
  isTuningRejectionReasonCode,
} from '../constants/tuning-contract.constants';
import { TuningMqttOutboxDispatcher } from './tuning-mqtt-outbox-dispatcher.service';

const COMMAND_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MAX_TUNING_HISTORY_OFFSET = 10_000;
const NON_USER_TUNING_ACTOR = 'non-user';

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

interface AckTransactionResult {
  readonly updated: boolean;
  readonly isLatest: boolean;
  readonly event: TuningSyncEvent | null;
}

@Injectable()
export class TuningConfigurationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TuningConfigurationService.name);
  public readonly tuningSync$ = new Subject<TuningSyncEvent>();
  private tuningReportedSub?: Subscription;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DeviceTuningConfiguration)
    private readonly configRepo: Repository<DeviceTuningConfiguration>,
    @InjectRepository(TuningAuditLog)
    private readonly auditRepo: Repository<TuningAuditLog>,
    @Inject(forwardRef(() => MqttService))
    private readonly mqttService: MqttService,
    private readonly outboxDispatcher: TuningMqttOutboxDispatcher,
  ) {}

  onModuleInit(): void {
    this.tuningReportedSub = this.mqttService.tuningReported$?.subscribe(
      (event) => {
        void this.handleReportedAck(event).catch((error: unknown) =>
          this.logError('Failed processing tuning ACK', error),
        );
      },
    );
  }

  onModuleDestroy(): void {
    this.tuningReportedSub?.unsubscribe();
  }

  async getLatestByDeviceId(
    deviceId: string,
  ): Promise<DeviceTuningConfiguration | null> {
    return this.configRepo.findOne({
      where: { deviceId: this.validDeviceId(deviceId) },
      order: { revision: 'DESC' },
    });
  }

  async getLatestForPrincipal(
    principal: TuningPrincipal,
    deviceId: string,
  ): Promise<DeviceTuningConfiguration | null> {
    await this.assertReadAccess(principal, deviceId);
    return this.getLatestByDeviceId(deviceId);
  }

  async getTuningHistory(
    deviceId: string,
    limit?: number,
    offset?: number,
  ): Promise<{
    items: TuningAuditLog[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const parsedLimit =
      Number.isInteger(limit) && (limit as number) >= 1
        ? Math.min(limit as number, 100)
        : 20;
    const parsedOffset = this.parseHistoryOffset(offset);
    const [items, total] = await this.auditRepo.findAndCount({
      where: { deviceId: this.validDeviceId(deviceId) },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: parsedLimit,
      skip: parsedOffset,
    });
    return { items, total, limit: parsedLimit, offset: parsedOffset };
  }

  async getHistoryForPrincipal(
    principal: TuningPrincipal,
    deviceId: string,
    limit?: number,
    offset?: number,
  ): Promise<{
    items: TuningAuditLog[];
    total: number;
    limit: number;
    offset: number;
  }> {
    await this.assertReadAccess(principal, deviceId);
    return this.getTuningHistory(deviceId, limit, offset);
  }

  private parseHistoryOffset(offset?: number): number {
    if (offset === undefined) return 0;
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > MAX_TUNING_HISTORY_OFFSET
    ) {
      throw new BadRequestException(
        `offset must be between 0 and ${MAX_TUNING_HISTORY_OFFSET}.`,
      );
    }
    return offset;
  }

  /** Persist first, publish immutable durable snapshot second. */
  async createPendingCommand(
    principal: TuningPrincipal,
    deviceId: string,
    config: TuningConfigSnapshot,
    commandId: string,
  ): Promise<DeviceTuningConfiguration> {
    this.validatePrincipal(principal);
    const normalizedDeviceId = this.validDeviceId(deviceId);
    this.validateCommandId(commandId);
    this.validateSnapshot(config);
    const pending = await this.createOrGetPending(
      principal.subject,
      normalizedDeviceId,
      config,
      commandId,
      principal,
    );
    await this.outboxDispatcher.dispatchDue();
    return pending;
  }

  /**
   * Creates a command for a verified owner. The ownership check is repeated
   * in the write transaction to close the guard-to-transaction TOCTOU window.
   */
  async createPendingCommandByOwner(
    ownerUserId: string,
    requestedBy: string,
    deviceId: string,
    config: TuningConfigSnapshot,
    commandId: string,
  ): Promise<DeviceTuningConfiguration> {
    this.validateOwnerUserId(ownerUserId);
    this.validateActor(requestedBy);
    const normalizedDeviceId = this.validDeviceId(deviceId);
    this.validateCommandId(commandId);
    this.validateSnapshot(config);
    const pending = await this.createOrGetPending(
      requestedBy,
      normalizedDeviceId,
      config,
      commandId,
      undefined,
      ownerUserId,
    );
    await this.outboxDispatcher.dispatchDue();
    return pending;
  }

  /** Creates a durable tuning command for the non-user dashboard mode. */
  async createPendingCommandNonUser(
    deviceId: string,
    config: TuningConfigSnapshot,
    commandId: string,
  ): Promise<DeviceTuningConfiguration> {
    const normalizedDeviceId = this.validDeviceId(deviceId);
    this.validateCommandId(commandId);
    this.validateSnapshot(config);
    const pending = await this.createOrGetPending(
      NON_USER_TUNING_ACTOR,
      normalizedDeviceId,
      config,
      commandId,
    );
    await this.outboxDispatcher.dispatchDue();
    return pending;
  }

  private async createOrGetPending(
    actor: string,
    deviceId: string,
    config: TuningConfigSnapshot,
    commandId: string,
    principal?: TuningPrincipal,
    ownerUserId?: string,
  ): Promise<DeviceTuningConfiguration> {
    try {
      return await this.dataSource.transaction((manager) =>
        this.createPendingInTransaction(
          manager,
          actor,
          deviceId,
          config,
          commandId,
          principal,
          ownerUserId,
        ),
      );
    } catch (error: unknown) {
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof NotFoundException
      )
        throw error;
      const existing = await this.recoverUniqueConstraintIdempotency(
        error,
        deviceId,
        commandId,
        config,
      );
      if (existing) return existing;
      this.logError('Failed to persist pending tuning command', error);
      throw new InternalServerErrorException(
        'Failed to create pending tuning command due to database error.',
      );
    }
  }

  private async createPendingInTransaction(
    manager: EntityManager,
    actor: string,
    deviceId: string,
    config: TuningConfigSnapshot,
    commandId: string,
    principal?: TuningPrincipal,
    ownerUserId?: string,
  ): Promise<DeviceTuningConfiguration> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      deviceId,
    ]);
    const device = await manager.findOne(Device, { where: { deviceId } });
    this.assertDeviceWritable(device, deviceId);
    if (principal) this.assertHouseScope(principal, device, deviceId);
    if (ownerUserId)
      await this.assertCurrentOwnership(manager, deviceId, ownerUserId);
    const existing = await manager.findOne(DeviceTuningConfiguration, {
      where: { deviceId, commandId },
    });
    if (existing) return this.getExistingOrThrowConflict(existing, config);
    return this.persistPendingWithAuditAndOutbox(
      manager,
      actor,
      deviceId,
      config,
      commandId,
    );
  }

  private getExistingOrThrowConflict(
    existing: DeviceTuningConfiguration,
    config: TuningConfigSnapshot,
  ): DeviceTuningConfiguration {
    if (!this.sameSnapshot(existing.config, config)) {
      throw new ConflictException(
        'commandId is already bound to a different tuning configuration.',
      );
    }
    return existing;
  }

  private async persistPendingWithAuditAndOutbox(
    manager: EntityManager,
    actor: string,
    deviceId: string,
    config: TuningConfigSnapshot,
    commandId: string,
  ): Promise<DeviceTuningConfiguration> {
    const latest = await manager.findOne(DeviceTuningConfiguration, {
      where: { deviceId },
      order: { revision: 'DESC' },
    });
    const saved = await manager.save(
      DeviceTuningConfiguration,
      manager.create(DeviceTuningConfiguration, {
        id: crypto.randomUUID(),
        deviceId,
        commandId,
        revision: (latest?.revision ?? 0) + 1,
        status: SyncStatus.PENDING,
        config: { ...config },
        publishedAt: null,
        reportedConfig: null,
        reportedRevision: null,
        appliedAt: null,
        rejectionReason: null,
        retainedClearPending: false,
        retainedClearAttempts: 0,
        retainedClearNextAt: null,
      }),
    );
    const before = latest?.status === SyncStatus.IN_SYNC ? latest.config : null;
    await this.outboxDispatcher.supersedeUndeliveredDesired(
      manager,
      saved.deviceId,
      saved.revision,
    );
    await this.writeAudit(
      manager,
      saved,
      actor,
      'api',
      'CREATE_PENDING',
      before,
      saved.config,
      'Create pending tuning command',
      'SUCCESS',
    );
    await this.outboxDispatcher.enqueueDesired(manager, saved);
    return saved;
  }

  private async recoverUniqueConstraintIdempotency(
    error: unknown,
    deviceId: string,
    commandId: string,
    config: TuningConfigSnapshot,
  ): Promise<DeviceTuningConfiguration | null> {
    if (!this.isUniqueViolation(error)) return null;
    const existing = await this.configRepo.findOne({
      where: { deviceId, commandId },
    });
    return existing ? this.getExistingOrThrowConflict(existing, config) : null;
  }

  async handleReportedAck(
    ack: TuningReportedEvent,
  ): Promise<{ updated: boolean; isLatest: boolean }> {
    if (!this.isValidAck(ack)) return { updated: false, isLatest: false };
    let result: AckTransactionResult;
    try {
      result = await this.dataSource.transaction((manager) =>
        this.processReportedAckInTransaction(manager, ack),
      );
    } catch (error: unknown) {
      this.logError(
        `Failed to handle tuning ACK for device '${ack.deviceId}'`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to process tuning acknowledgement due to database error.',
      );
    }
    await this.publishCommittedAckResult(result);
    return { updated: result.updated, isLatest: result.isLatest };
  }

  /** Performs only durable state work and returns an immutable post-commit intent. */
  private async processReportedAckInTransaction(
    manager: EntityManager,
    ack: TuningReportedEvent,
  ): Promise<AckTransactionResult> {
    const config = await this.loadLockedCommand(manager, ack);
    if (!config) {
      this.logger.warn(
        `SECURITY: unknown tuning ACK device='${ack.deviceId}' command='${ack.commandId}'.`,
      );
      return { updated: false, isLatest: false, event: null };
    }
    const latest = await manager.findOne(DeviceTuningConfiguration, {
      where: { deviceId: ack.deviceId },
      order: { revision: 'DESC' },
    });
    const isLatest = latest?.id === config.id;
    if (config.status !== SyncStatus.PENDING) {
      return { updated: false, isLatest, event: null };
    }
    const accepted = await this.transitionReportedAck(
      manager,
      config,
      ack,
      isLatest,
    );
    const before = await this.findPriorSyncedSnapshot(manager, ack, config);
    await this.persistAuditAndOutbox(
      manager,
      config,
      ack,
      accepted,
      before,
      isLatest,
    );
    return { updated: true, isLatest, event: this.toEvent(config) };
  }

  /** Runs after the transaction promise resolves, so SSE cannot precede commit. */
  private async publishCommittedAckResult(
    result: AckTransactionResult,
  ): Promise<void> {
    if (result.event) this.tuningSync$.next(result.event);
    if (result.updated && result.isLatest)
      await this.outboxDispatcher.dispatchDue();
  }

  private async findPriorSyncedSnapshot(
    manager: EntityManager,
    ack: TuningReportedEvent,
    config: DeviceTuningConfiguration,
  ): Promise<TuningConfigSnapshot | null> {
    const before = await manager.findOne(DeviceTuningConfiguration, {
      where: {
        deviceId: ack.deviceId,
        status: SyncStatus.IN_SYNC,
        revision: LessThan(config.revision),
      },
      order: { revision: 'DESC' },
    });
    return before?.reportedConfig ?? before?.config ?? null;
  }

  private validateSnapshot(config: TuningConfigSnapshot): void {
    if (
      !config ||
      Object.values(config).some(
        (value) => typeof value !== 'number' || !Number.isFinite(value),
      )
    )
      throw new BadRequestException(
        'All tuning parameters must be finite numbers.',
      );
    this.inRange(
      'lamp_gain_scale',
      config.lamp_gain_scale,
      LAMP_GAIN_SCALE_MIN,
      LAMP_GAIN_SCALE_MAX,
    );
    this.inRange(
      'mist_gain_scale',
      config.mist_gain_scale,
      MIST_GAIN_SCALE_MIN,
      MIST_GAIN_SCALE_MAX,
    );
    this.inRange(
      'mist_on_threshold',
      config.mist_on_threshold,
      MIST_ON_THRESHOLD_MIN,
      MIST_ON_THRESHOLD_MAX,
    );
    this.inRange(
      'mist_off_threshold',
      config.mist_off_threshold,
      MIST_OFF_THRESHOLD_MIN,
      MIST_OFF_THRESHOLD_MAX,
    );
    if (
      config.mist_off_threshold >=
      config.mist_on_threshold - MIN_THRESHOLD_GAP
    )
      throw new BadRequestException(
        'mist_off_threshold must be strictly less than mist_on_threshold with a minimum gap of 0.001.',
      );
  }

  private assertDeviceAccess(
    device: Device | null,
    principal: TuningPrincipal,
    deviceId: string,
  ): void {
    this.assertDeviceWritable(device, deviceId);
    this.assertHouseScope(principal, device, deviceId);
  }
  private assertDeviceWritable(
    device: Device | null,
    deviceId: string,
  ): asserts device is Device {
    if (!device) throw new NotFoundException(`Device '${deviceId}' not found.`);
    if (!device.enabled)
      throw new BadRequestException(`Device '${deviceId}' is disabled.`);
  }
  private assertHouseScope(
    principal: TuningPrincipal,
    device: Device,
    deviceId: string,
  ): void {
    if (
      !principal.isAdmin &&
      !principal.allowedHouseIds.includes(device.houseId)
    )
      throw new ForbiddenException(
        `Not authorized to tune device '${deviceId}'.`,
      );
  }
  private async assertCurrentOwnership(
    manager: EntityManager,
    deviceId: string,
    ownerUserId: string,
  ): Promise<void> {
    const rows: unknown = await manager.query(
      'SELECT 1 FROM devices WHERE device_id = $1 AND owner_user_id = $2 FOR UPDATE',
      [deviceId, ownerUserId],
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ForbiddenException('Device ownership could not be verified.');
    }
  }
  private async assertReadAccess(
    principal: TuningPrincipal,
    deviceId: string,
  ): Promise<void> {
    this.validatePrincipal(principal);
    const normalizedDeviceId = this.validDeviceId(deviceId);
    const device = await this.dataSource.manager.findOne(Device, {
      where: { deviceId: normalizedDeviceId },
    });
    this.assertDeviceAccess(device, principal, normalizedDeviceId);
  }

  private async writeAudit(
    manager: EntityManager,
    config: DeviceTuningConfiguration,
    actor: string,
    source: string,
    action: string,
    before: TuningConfigSnapshot | null,
    after: TuningConfigSnapshot | null,
    reason: string | null,
    result: string,
  ): Promise<void> {
    await manager.save(
      TuningAuditLog,
      manager.create(TuningAuditLog, {
        id: crypto.randomUUID(),
        configurationId: config.id,
        deviceId: config.deviceId,
        actor,
        source,
        action,
        rulesetVersion: null,
        kpiSnapshot: null,
        configBefore: before,
        configAfter: after,
        reason,
        result,
      }),
    );
  }

  private async loadLockedCommand(
    manager: EntityManager,
    ack: TuningReportedEvent,
  ): Promise<DeviceTuningConfiguration | null> {
    return manager.findOne(DeviceTuningConfiguration, {
      where: { deviceId: ack.deviceId, commandId: ack.commandId },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private async transitionReportedAck(
    manager: EntityManager,
    config: DeviceTuningConfiguration,
    ack: TuningReportedEvent,
    isLatest: boolean,
  ): Promise<boolean> {
    const rejectionReason = this.ackRejectionReason(ack, config);
    const accepted = rejectionReason === null;
    config.status = accepted ? SyncStatus.IN_SYNC : SyncStatus.REJECTED;
    config.reportedConfig = ack.reportedConfig
      ? { ...ack.reportedConfig }
      : null;
    config.reportedRevision = ack.revision;
    config.appliedAt = accepted ? ack.receivedAt : null;
    config.rejectionReason = rejectionReason;
    if (accepted && isLatest) {
      config.retainedClearPending = true;
      config.retainedClearAttempts = 0;
      config.retainedClearNextAt = new Date();
    }
    config.updatedAt = new Date();
    await manager.save(DeviceTuningConfiguration, config);
    return accepted;
  }

  private async persistAuditAndOutbox(
    manager: EntityManager,
    config: DeviceTuningConfiguration,
    ack: TuningReportedEvent,
    accepted: boolean,
    before: TuningConfigSnapshot | null,
    isLatest: boolean,
  ): Promise<void> {
    if (accepted && isLatest)
      await this.outboxDispatcher.enqueueRetainedClear(manager, config);
    await this.writeAudit(
      manager,
      config,
      'device',
      'mqtt',
      accepted ? 'SYNC_ACCEPTED' : 'SYNC_REJECTED',
      before,
      config.reportedConfig,
      config.rejectionReason ?? ack.reasonCode,
      accepted ? 'SUCCESS' : 'FAILED',
    );
  }

  private isValidAck(ack: TuningReportedEvent): boolean {
    if (
      !ack ||
      typeof ack.deviceId !== 'string' ||
      !ack.deviceId.trim() ||
      ack.deviceId.length > 50 ||
      typeof ack.commandId !== 'string' ||
      !COMMAND_ID_PATTERN.test(ack.commandId) ||
      !['ACCEPTED', 'DUPLICATE', 'REJECTED'].includes(ack.status) ||
      typeof ack.persisted !== 'boolean'
    )
      return false;
    if (ack.status === 'REJECTED') {
      return (
        ack.persisted === false &&
        isTuningRejectionReasonCode(ack.reasonCode) &&
        ack.reportedConfig === null &&
        ack.revision === null
      );
    }
    if (
      ack.reasonCode !== null ||
      ack.revision === null ||
      !Number.isSafeInteger(ack.revision) ||
      ack.revision < 0 ||
      !ack.reportedConfig
    )
      return false;
    try {
      this.validateSnapshot(ack.reportedConfig);
      return true;
    } catch {
      return false;
    }
  }
  private validDeviceId(value: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > 50)
      throw new BadRequestException(
        'deviceId is required and must be under 50 characters.',
      );
    return value.trim();
  }
  private validateCommandId(value: string): void {
    if (typeof value !== 'string' || !COMMAND_ID_PATTERN.test(value))
      throw new BadRequestException('commandId must be a valid UUID.');
  }
  private validateActor(value: string): void {
    if (typeof value !== 'string' || !value.trim())
      throw new ForbiddenException('A verified tuning actor is required.');
  }
  private validateOwnerUserId(value: string): void {
    if (typeof value !== 'string' || !value.trim())
      throw new ForbiddenException('A verified device owner is required.');
  }
  private validatePrincipal(principal: TuningPrincipal): void {
    if (
      !principal ||
      typeof principal.subject !== 'string' ||
      !principal.subject.trim() ||
      !Array.isArray(principal.allowedHouseIds)
    )
      throw new ForbiddenException('A verified tuning principal is required.');
  }
  private inRange(name: string, value: number, min: number, max: number): void {
    if (value < min || value > max)
      throw new BadRequestException(
        `${name} must be between ${min.toFixed(2)} and ${max.toFixed(2)}.`,
      );
  }
  private toEvent(config: DeviceTuningConfiguration): TuningSyncEvent {
    return {
      id: config.id,
      deviceId: config.deviceId,
      commandId: config.commandId,
      revision: config.revision,
      status: config.status,
      config: config.config,
      publishedAt: config.publishedAt?.toISOString() ?? null,
      createdAt: config.createdAt.toISOString(),
      updatedAt: config.updatedAt.toISOString(),
    };
  }
  private emit(config: DeviceTuningConfiguration): void {
    this.tuningSync$.next(this.toEvent(config));
  }
  private sameSnapshot(
    left: TuningConfigSnapshot,
    right: TuningConfigSnapshot,
  ): boolean {
    return (
      left.lamp_gain_scale === right.lamp_gain_scale &&
      left.mist_gain_scale === right.mist_gain_scale &&
      left.mist_on_threshold === right.mist_on_threshold &&
      left.mist_off_threshold === right.mist_off_threshold
    );
  }
  private ackRejectionReason(
    ack: TuningReportedEvent,
    config: DeviceTuningConfiguration,
  ): string | null {
    if (ack.status === 'REJECTED') return ack.reasonCode ?? 'EDGE_REJECTED';
    if (!ack.persisted) return 'PERSISTENCE_NOT_CONFIRMED';
    if (ack.revision !== config.revision) return 'REVISION_MISMATCH';
    return ack.reportedConfig &&
      this.sameSnapshot(config.config, ack.reportedConfig)
      ? null
      : 'CANONICAL_MISMATCH';
  }
  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === '23505'
    );
  }
  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
  private logError(message: string, error: unknown): void {
    this.logger.error(`${message}: ${this.errorMessage(error)}`);
  }
}
