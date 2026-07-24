import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, DataSource } from 'typeorm';
import { Subject } from 'rxjs';
import {
  DeviceTuningConfiguration,
  SyncStatus,
  TuningConfigSnapshot,
} from '../entities/device-tuning-configuration.entity';
import { TuningAuditLog } from '../entities/tuning-audit-log.entity';
import { TuningReportedEvent } from '../../mqtt/mqtt.service';
import * as crypto from 'crypto';

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
export class TuningConfigurationService {
  private readonly logger = new Logger(TuningConfigurationService.name);
  public readonly tuningSync$ = new Subject<TuningSyncEvent>();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DeviceTuningConfiguration)
    private readonly configRepo: Repository<DeviceTuningConfiguration>,
    @InjectRepository(TuningAuditLog)
    private readonly auditRepo: Repository<TuningAuditLog>,
  ) {}

  /**
   * Handles reported tuning ACK from device.
   * Enforces transactional outbox discipline, pessimistic row locks,
   * idempotency, canonical comparisons, audit logs, and SSE events after commit.
   */
  async handleReportedAck(ack: TuningReportedEvent): Promise<{ updated: boolean; isLatest: boolean }> {
    // 1. Type guard / Validation
    if (!ack || typeof ack !== 'object') {
      this.logger.warn('Dropped invalid tuning ACK payload.');
      return { updated: false, isLatest: false };
    }

    const { deviceId, commandId, status } = ack;
    if (
      !deviceId ||
      typeof deviceId !== 'string' ||
      deviceId.trim().length === 0 ||
      deviceId.length > 50
    ) {
      this.logger.warn(`Dropped tuning ACK with invalid deviceId: '${deviceId}'`);
      return { updated: false, isLatest: false };
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!commandId || typeof commandId !== 'string' || !uuidRegex.test(commandId)) {
      this.logger.warn(`Dropped tuning ACK with malformed commandId: '${commandId}' for device '${deviceId}'.`);
      return { updated: false, isLatest: false };
    }

    if (status !== 'ACCEPTED' && status !== 'DUPLICATE' && status !== 'REJECTED') {
      this.logger.warn(`Dropped tuning ACK with unknown status: '${status}' for device '${deviceId}'.`);
      return { updated: false, isLatest: false };
    }

    const result = { updated: false, isLatest: false };
    let eventToEmit: TuningSyncEvent | null = null;

    try {
      await this.dataSource.transaction(async (manager) => {
        // 2. Select with pessimistic write lock (SELECT ... FOR UPDATE)
        const config = await manager.findOne(DeviceTuningConfiguration, {
          where: { commandId, deviceId },
          lock: { mode: 'pessimistic_write' },
        });

        // ACK unknown/mismatched device ID: security log & return without mutating
        if (!config) {
          this.logger.warn(
            `SECURITY WARNING: Received tuning ACK for unknown command '${commandId}' or mismatch device '${deviceId}'.`
          );
          return;
        }

        if (config.deviceId !== deviceId) {
          this.logger.warn(
            `SECURITY WARNING: Device ID mismatch. Config deviceId '${config.deviceId}' does not match ACK deviceId '${deviceId}' for command '${commandId}'.`
          );
          return;
        }

        // Determine if this is the latest command for the device
        const latestConfig = await manager.findOne(DeviceTuningConfiguration, {
          where: { deviceId },
          order: { createdAt: 'DESC' },
        });
        const isLatest = latestConfig ? latestConfig.commandId === commandId : false;
        result.isLatest = isLatest;

        // 3. Idempotency Check
        if (config.status === SyncStatus.IN_SYNC || config.status === SyncStatus.REJECTED) {
          this.logger.debug(
            `Tuning ACK for command '${commandId}' is already processed (status: ${config.status}). Idempotent skip.`
          );
          return;
        }

        // 4. State Transition
        let nextStatus: SyncStatus;
        if (status === 'ACCEPTED' || status === 'DUPLICATE') {
          nextStatus = SyncStatus.IN_SYNC;
        } else {
          nextStatus = SyncStatus.REJECTED;
        }

        config.status = nextStatus;
        config.updatedAt = new Date();
        await manager.save(DeviceTuningConfiguration, config);

        // 5. Canonical Comparison & Audit Log
        const prevConfig = await manager.findOne(DeviceTuningConfiguration, {
          where: {
            deviceId,
            status: SyncStatus.IN_SYNC,
            createdAt: LessThan(config.createdAt),
          },
          order: { createdAt: 'DESC' },
        });

        const configBefore = prevConfig ? prevConfig.config : null;
        const configAfter = config.config;

        const auditLog = manager.create(TuningAuditLog, {
          id: crypto.randomUUID(),
          configurationId: config.id,
          deviceId: config.deviceId,
          actor: 'device',
          source: 'mqtt',
          action: nextStatus === SyncStatus.IN_SYNC ? 'SYNC_ACCEPTED' : 'SYNC_REJECTED',
          rulesetVersion: null,
          kpiSnapshot: null,
          configBefore,
          configAfter,
          reason: ack.reasonCode,
          result: nextStatus === SyncStatus.IN_SYNC ? 'SUCCESS' : 'FAILED',
        });
        await manager.save(TuningAuditLog, auditLog);

        result.updated = true;

        // Prepare SSE event to emit after successful commit
        eventToEmit = {
          id: config.id,
          deviceId: config.deviceId,
          commandId: config.commandId,
          revision: config.revision,
          status: config.status,
          config: config.config,
          publishedAt: config.publishedAt ? config.publishedAt.toISOString() : null,
          createdAt: config.createdAt.toISOString(),
          updatedAt: config.updatedAt.toISOString(),
        };
      });
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(
        `Failed to handle tuning ACK for device '${deviceId}' and command '${commandId}': ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
      throw new InternalServerErrorException(
        'Failed to process tuning acknowledgement due to database error.'
      );
    }

    // 6. SSE Event Emission after successful commit
    if (result.updated && eventToEmit) {
      this.tuningSync$.next(eventToEmit);
    }

    return result;
  }
}
