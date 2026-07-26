import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import {
  DataSource,
  EntityManager,
  IsNull,
  LessThanOrEqual,
  Repository,
} from 'typeorm';
import { MqttService } from '../../mqtt/mqtt.service';
import {
  DeviceTuningConfiguration,
  SyncStatus,
  TuningConfigSnapshot,
} from '../entities/device-tuning-configuration.entity';
import {
  TuningMqttOutbox,
  TuningMqttOutboxAction,
} from '../entities/tuning-mqtt-outbox.entity';

const OUTBOX_RETRY_MS = 5_000;
const OUTBOX_MAX_DELAY_MS = 5 * 60_000;
const OUTBOX_LEASE_MS = 30_000;

interface DispatchClaim {
  outboxId: string;
  deviceId: string;
  configurationId: string;
  action: TuningMqttOutboxAction;
  revision: number;
  payload: TuningConfigSnapshot | null;
  commandId: string;
}

/**
 * The sole MQTT side-effect owner for tuning. A short DB transaction claims an
 * item through a durable lease, MQTT is published after that transaction has
 * committed, and a second transaction finalizes/retries the claim. This keeps
 * row/advisory locks away from unbounded broker I/O while preserving one active
 * publisher per device (including retained-clear fencing).
 */
@Injectable()
export class TuningMqttOutboxDispatcher
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TuningMqttOutboxDispatcher.name);
  private readonly workerId = crypto.randomUUID();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TuningMqttOutbox)
    private readonly outboxRepo: Repository<TuningMqttOutbox>,
    @Inject(forwardRef(() => MqttService))
    private readonly mqttService: MqttService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatchDue(), OUTBOX_RETRY_MS);
    this.timer.unref();
    void this.dispatchDue();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  enqueueDesired(
    manager: EntityManager,
    config: DeviceTuningConfiguration,
  ): Promise<TuningMqttOutbox> {
    return manager.save(
      TuningMqttOutbox,
      manager.create(TuningMqttOutbox, {
        id: crypto.randomUUID(),
        deviceId: config.deviceId,
        configurationId: config.id,
        action: TuningMqttOutboxAction.PUBLISH_DESIRED,
        revision: config.revision,
        payload: { ...config.config },
        attempts: 0,
        nextAttemptAt: new Date(),
        deliveredAt: null,
        processingAt: null,
        leaseExpiresAt: null,
        workerId: null,
      }),
    );
  }

  /** A newer desired makes every undelivered prior desired permanently unsafe. */
  async supersedeUndeliveredDesired(
    manager: EntityManager,
    deviceId: string,
    revision: number,
  ): Promise<void> {
    await manager.query(
      `UPDATE tuning_mqtt_outbox
       SET delivered_at = NOW(), processing_at = NULL, lease_expires_at = NULL,
           worker_id = NULL, updated_at = NOW()
       WHERE device_id = $1 AND action = $2 AND delivered_at IS NULL AND revision < $3`,
      [deviceId, TuningMqttOutboxAction.PUBLISH_DESIRED, revision],
    );
  }

  enqueueRetainedClear(
    manager: EntityManager,
    config: DeviceTuningConfiguration,
  ): Promise<TuningMqttOutbox> {
    return manager.save(
      TuningMqttOutbox,
      manager.create(TuningMqttOutbox, {
        id: crypto.randomUUID(),
        deviceId: config.deviceId,
        configurationId: config.id,
        action: TuningMqttOutboxAction.CLEAR_RETAINED,
        revision: config.revision,
        payload: null,
        attempts: 0,
        nextAttemptAt: new Date(),
        deliveredAt: null,
        processingAt: null,
        leaseExpiresAt: null,
        workerId: null,
      }),
    );
  }

  async dispatchDue(): Promise<void> {
    const now = new Date();
    const due = await this.outboxRepo.find({
      where: {
        deliveredAt: IsNull(),
        nextAttemptAt: LessThanOrEqual(now),
      },
      order: { nextAttemptAt: 'ASC', revision: 'DESC', createdAt: 'ASC' },
      take: 20,
    });
    for (const item of due) await this.dispatchOne(item.id);
  }

  private async dispatchOne(outboxId: string): Promise<void> {
    let claim: DispatchClaim | null;
    try {
      claim = await this.claim(outboxId);
    } catch (error: unknown) {
      await this.scheduleRetry(outboxId);
      this.logRetry(outboxId, error);
      return;
    }
    if (!claim) return;

    try {
      await this.publish(claim);
      await this.finalizeDelivered(claim);
    } catch (error: unknown) {
      await this.scheduleRetry(outboxId);
      this.logRetry(outboxId, error);
    }
  }

  /** Transaction A: atomically claim one deliverable item and commit promptly. */
  private async claim(outboxId: string): Promise<DispatchClaim | null> {
    return this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(TuningMqttOutbox, {
        where: { id: outboxId },
        lock: { mode: 'pessimistic_write' },
      });
      const now = new Date();
      if (!item || !this.isClaimable(item, now)) return null;

      // This lock only protects the fast claim/finalize transaction. MQTT I/O
      // happens after commit; the durable per-device lease protects ordering.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        item.deviceId,
      ]);
      const activeLease: unknown = await manager.query(
        `SELECT 1 FROM tuning_mqtt_outbox
         WHERE device_id = $1 AND id <> $2 AND delivered_at IS NULL
           AND lease_expires_at > NOW()
         LIMIT 1`,
        [item.deviceId, item.id],
      );
      if (Array.isArray(activeLease) && activeLease.length > 0) return null;

      const config = await manager.findOne(DeviceTuningConfiguration, {
        where: { id: item.configurationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!config || !(await this.shouldDeliver(manager, item, config))) {
        await this.markObsolete(manager, item, config);
        return null;
      }

      item.processingAt = now;
      item.leaseExpiresAt = new Date(now.getTime() + OUTBOX_LEASE_MS);
      item.workerId = this.workerId;
      await manager.save(TuningMqttOutbox, item);
      return {
        outboxId: item.id,
        deviceId: item.deviceId,
        configurationId: item.configurationId,
        action: item.action,
        revision: item.revision,
        payload: item.payload,
        commandId: config.commandId,
      };
    });
  }

  /** Transaction B: re-lock, verify the still-owned lease/current state, then persist delivery. */
  private async finalizeDelivered(claim: DispatchClaim): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(TuningMqttOutbox, {
        where: { id: claim.outboxId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item || item.deliveredAt || !this.ownsLease(item)) return;
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        item.deviceId,
      ]);
      const config = await manager.findOne(DeviceTuningConfiguration, {
        where: { id: item.configurationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!config || !(await this.shouldDeliver(manager, item, config))) {
        await this.markObsolete(manager, item, config);
        return;
      }

      const deliveredAt = new Date();
      item.deliveredAt = deliveredAt;
      this.releaseLease(item);
      if (item.action === TuningMqttOutboxAction.PUBLISH_DESIRED)
        config.publishedAt = deliveredAt;
      if (item.action === TuningMqttOutboxAction.CLEAR_RETAINED) {
        config.retainedClearPending = false;
        config.retainedClearNextAt = null;
      }
      await manager.save(TuningMqttOutbox, item);
      await manager.save(DeviceTuningConfiguration, config);
    });
  }

  private isClaimable(item: TuningMqttOutbox, now: Date): boolean {
    return (
      !item.deliveredAt &&
      item.nextAttemptAt.getTime() <= now.getTime() &&
      (!item.leaseExpiresAt || item.leaseExpiresAt.getTime() <= now.getTime())
    );
  }

  private ownsLease(item: TuningMqttOutbox): boolean {
    return (
      item.workerId === this.workerId &&
      item.leaseExpiresAt !== null &&
      item.leaseExpiresAt.getTime() > Date.now()
    );
  }

  private releaseLease(item: TuningMqttOutbox): void {
    item.processingAt = null;
    item.leaseExpiresAt = null;
    item.workerId = null;
  }

  private async markObsolete(
    manager: EntityManager,
    item: TuningMqttOutbox,
    config: DeviceTuningConfiguration | null,
  ): Promise<void> {
    item.deliveredAt = new Date();
    this.releaseLease(item);
    if (config && item.action === TuningMqttOutboxAction.CLEAR_RETAINED) {
      config.retainedClearPending = false;
      config.retainedClearNextAt = null;
      await manager.save(DeviceTuningConfiguration, config);
    }
    await manager.save(TuningMqttOutbox, item);
  }

  private async shouldDeliver(
    manager: EntityManager,
    item: TuningMqttOutbox,
    config: DeviceTuningConfiguration,
  ): Promise<boolean> {
    const latest = await manager.findOne(DeviceTuningConfiguration, {
      where: { deviceId: config.deviceId },
      order: { revision: 'DESC' },
    });
    if (item.action === TuningMqttOutboxAction.PUBLISH_DESIRED) {
      return (
        config.status === SyncStatus.PENDING &&
        latest?.id === config.id &&
        item.revision === config.revision
      );
    }
    return config.status === SyncStatus.IN_SYNC && latest?.id === config.id;
  }

  private async publish(claim: DispatchClaim): Promise<void> {
    if (claim.action === TuningMqttOutboxAction.CLEAR_RETAINED)
      return this.mqttService.clearTuningDesired(claim.deviceId);
    if (!claim.payload)
      throw new Error('Desired outbox item is missing payload');
    return this.mqttService.publishTuningDesired(
      claim.deviceId,
      claim.commandId,
      claim.revision,
      claim.payload,
    );
  }

  private async scheduleRetry(outboxId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(TuningMqttOutbox, {
        where: { id: outboxId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!item || item.deliveredAt) return;
      // Do not steal a live lease belonging to another replica.
      if (
        item.workerId &&
        item.workerId !== this.workerId &&
        this.ownsLiveLease(item)
      )
        return;
      item.attempts += 1;
      item.nextAttemptAt = new Date(
        Date.now() +
          Math.min(
            OUTBOX_RETRY_MS * 2 ** Math.min(item.attempts - 1, 6),
            OUTBOX_MAX_DELAY_MS,
          ),
      );
      this.releaseLease(item);
      await manager.save(TuningMqttOutbox, item);
    });
  }

  private ownsLiveLease(item: TuningMqttOutbox): boolean {
    return (
      item.leaseExpiresAt !== null && item.leaseExpiresAt.getTime() > Date.now()
    );
  }

  private logRetry(outboxId: string, error: unknown): void {
    this.logger.warn(
      `Tuning MQTT outbox '${outboxId}' will retry: ${this.errorMessage(error)}`,
    );
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
