import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'crypto';
import { DataSource, EntityManager, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { MqttService } from '../../mqtt/mqtt.service';
import { DeviceTuningConfiguration, SyncStatus, TuningConfigSnapshot } from '../entities/device-tuning-configuration.entity';
import { TuningMqttOutbox, TuningMqttOutboxAction } from '../entities/tuning-mqtt-outbox.entity';

const OUTBOX_RETRY_MS = 5_000;
const OUTBOX_MAX_DELAY_MS = 5 * 60_000;

/**
 * The sole MQTT side-effect owner for tuning. It holds the per-device database
 * advisory lock while publishing and recording delivery, so command creation,
 * desired publish and retained clear cannot interleave for a device.
 */
@Injectable()
export class TuningMqttOutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TuningMqttOutboxDispatcher.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TuningMqttOutbox) private readonly outboxRepo: Repository<TuningMqttOutbox>,
    @Inject(forwardRef(() => MqttService)) private readonly mqttService: MqttService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatchDue(), OUTBOX_RETRY_MS);
    this.timer.unref();
    void this.dispatchDue();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  enqueueDesired(manager: EntityManager, config: DeviceTuningConfiguration): Promise<TuningMqttOutbox> {
    return manager.save(TuningMqttOutbox, manager.create(TuningMqttOutbox, {
      id: crypto.randomUUID(), deviceId: config.deviceId, configurationId: config.id,
      action: TuningMqttOutboxAction.PUBLISH_DESIRED, revision: config.revision,
      payload: { ...config.config }, attempts: 0, nextAttemptAt: new Date(), deliveredAt: null,
    }));
  }

  /** A newer desired makes every undelivered prior desired permanently unsafe. */
  async supersedeUndeliveredDesired(manager: EntityManager, deviceId: string, revision: number): Promise<void> {
    await manager.query(
      `UPDATE tuning_mqtt_outbox
       SET delivered_at = NOW(), updated_at = NOW()
       WHERE device_id = $1 AND action = $2 AND delivered_at IS NULL AND revision < $3`,
      [deviceId, TuningMqttOutboxAction.PUBLISH_DESIRED, revision],
    );
  }

  enqueueRetainedClear(manager: EntityManager, config: DeviceTuningConfiguration): Promise<TuningMqttOutbox> {
    return manager.save(TuningMqttOutbox, manager.create(TuningMqttOutbox, {
      id: crypto.randomUUID(), deviceId: config.deviceId, configurationId: config.id,
      action: TuningMqttOutboxAction.CLEAR_RETAINED, revision: config.revision,
      payload: null, attempts: 0, nextAttemptAt: new Date(), deliveredAt: null,
    }));
  }

  async dispatchDue(): Promise<void> {
    const due = await this.outboxRepo.find({
      where: { deliveredAt: IsNull(), nextAttemptAt: LessThanOrEqual(new Date()) },
      order: { nextAttemptAt: 'ASC', revision: 'DESC', createdAt: 'ASC' }, take: 20,
    });
    for (const item of due) await this.dispatchOne(item.id);
  }

  private async dispatchOne(outboxId: string): Promise<void> {
    try {
      await this.dataSource.transaction(async (manager) => {
        const candidate = await manager.findOne(TuningMqttOutbox, { where: { id: outboxId }, lock: { mode: 'pessimistic_write' } });
        if (!candidate || candidate.deliveredAt || candidate.nextAttemptAt.getTime() > Date.now()) return;
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [candidate.deviceId]);
        const config = await manager.findOne(DeviceTuningConfiguration, { where: { id: candidate.configurationId }, lock: { mode: 'pessimistic_write' } });
        if (!config || !(await this.shouldDeliver(manager, candidate, config))) {
          candidate.deliveredAt = new Date();
          if (config && candidate.action === TuningMqttOutboxAction.CLEAR_RETAINED) {
            config.retainedClearPending = false;
            config.retainedClearNextAt = null;
            await manager.save(DeviceTuningConfiguration, config);
          }
          await manager.save(TuningMqttOutbox, candidate);
          return;
        }
        await this.publish(candidate, config);
        candidate.deliveredAt = new Date();
        if (candidate.action === TuningMqttOutboxAction.PUBLISH_DESIRED) config.publishedAt = candidate.deliveredAt;
        if (candidate.action === TuningMqttOutboxAction.CLEAR_RETAINED) {
          config.retainedClearPending = false;
          config.retainedClearNextAt = null;
        }
        await manager.save(TuningMqttOutbox, candidate);
        await manager.save(DeviceTuningConfiguration, config);
      });
    } catch (error: unknown) {
      await this.scheduleRetry(outboxId);
      this.logger.warn(`Tuning MQTT outbox '${outboxId}' will retry: ${this.errorMessage(error)}`);
    }
  }

  private async shouldDeliver(manager: EntityManager, item: TuningMqttOutbox, config: DeviceTuningConfiguration): Promise<boolean> {
    if (item.action === TuningMqttOutboxAction.PUBLISH_DESIRED) {
      const latest = await manager.findOne(DeviceTuningConfiguration, {
        where: { deviceId: config.deviceId }, order: { revision: 'DESC' },
      });
      return config.status === SyncStatus.PENDING && latest?.id === config.id && item.revision === config.revision;
    }
    const latest = await manager.findOne(DeviceTuningConfiguration, { where: { deviceId: config.deviceId }, order: { revision: 'DESC' } });
    return config.status === SyncStatus.IN_SYNC && latest?.id === config.id;
  }

  private async publish(item: TuningMqttOutbox, config: DeviceTuningConfiguration): Promise<void> {
    if (item.action === TuningMqttOutboxAction.CLEAR_RETAINED) return this.mqttService.clearTuningDesired(config.deviceId);
    return this.mqttService.publishTuningDesired(config.deviceId, config.commandId, config.revision, item.payload as TuningConfigSnapshot);
  }

  private async scheduleRetry(outboxId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(TuningMqttOutbox, { where: { id: outboxId }, lock: { mode: 'pessimistic_write' } });
      if (!item || item.deliveredAt) return;
      item.attempts += 1;
      item.nextAttemptAt = new Date(Date.now() + Math.min(OUTBOX_RETRY_MS * 2 ** Math.min(item.attempts - 1, 6), OUTBOX_MAX_DELAY_MS));
      await manager.save(TuningMqttOutbox, item);
    });
  }

  private errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Unknown error'; }
}
