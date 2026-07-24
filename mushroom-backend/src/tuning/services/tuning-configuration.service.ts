import {
  Injectable,
  Logger,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
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
import { Device } from '../../device/entities/device.entity';
import { MqttService } from '../../mqtt/mqtt.service';
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
    @Inject(forwardRef(() => MqttService))
    private readonly mqttService: MqttService,
  ) {}

  /**
   * Fetches the latest durable tuning configuration shadow for a device.
   * Deterministically orders by createdAt DESC LIMIT 1 directly from database.
   */
  async getLatestByDeviceId(deviceId: string): Promise<DeviceTuningConfiguration | null> {
    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length === 0 || deviceId.length > 50) {
      throw new BadRequestException('deviceId is required and must be under 50 characters.');
    }

    return await this.configRepo.findOne({
      where: { deviceId: deviceId.trim() },
      order: { createdAt: 'DESC' },
    });
  }


  /**
   * Creates a pending tuning command, publishes it via MQTT, and logs audit events.
   * Ensures idempotency using the commandId, performs ownership validation,
   * handles MQTT publication errors gracefully by transitioning to REJECTED with audit logs.
   */
  async createPendingCommand(
    actor: string,
    deviceId: string,
    inputConfig: TuningConfigSnapshot,
    commandId: string,
  ): Promise<DeviceTuningConfiguration> {
    // 1. Validation & Inputs Guard
    if (!actor || typeof actor !== 'string' || actor.trim().length === 0) {
      throw new BadRequestException('Actor is required and must be a non-empty string.');
    }

    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length === 0 || deviceId.length > 50) {
      throw new BadRequestException('deviceId is required and must be under 50 characters.');
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!commandId || typeof commandId !== 'string' || !uuidRegex.test(commandId)) {
      throw new BadRequestException('commandId must be a valid UUID v4.');
    }

    if (!inputConfig || typeof inputConfig !== 'object') {
      throw new BadRequestException('Config snapshot is required.');
    }

    const {
      lamp_gain_scale,
      mist_gain_scale,
      mist_on_threshold,
      mist_off_threshold,
    } = inputConfig;

    if (
      typeof lamp_gain_scale !== 'number' ||
      typeof mist_gain_scale !== 'number' ||
      typeof mist_on_threshold !== 'number' ||
      typeof mist_off_threshold !== 'number' ||
      !Number.isFinite(lamp_gain_scale) ||
      !Number.isFinite(mist_gain_scale) ||
      !Number.isFinite(mist_on_threshold) ||
      !Number.isFinite(mist_off_threshold)
    ) {
      throw new BadRequestException('All tuning parameters must be finite numbers.');
    }

    if (lamp_gain_scale < 0.0 || lamp_gain_scale > 5.0) {
      throw new BadRequestException('lamp_gain_scale must be between 0.0 and 5.0.');
    }
    if (mist_gain_scale < 0.0 || mist_gain_scale > 5.0) {
      throw new BadRequestException('mist_gain_scale must be between 0.0 and 5.0.');
    }
    if (mist_on_threshold < 0.0 || mist_on_threshold > 1.0) {
      throw new BadRequestException('mist_on_threshold must be between 0.0 and 1.0.');
    }
    if (mist_off_threshold < 0.0 || mist_off_threshold > 1.0) {
      throw new BadRequestException('mist_off_threshold must be between 0.0 and 1.0.');
    }
    if (mist_off_threshold >= mist_on_threshold - 0.001) {
      throw new BadRequestException(
        'mist_off_threshold must be strictly less than mist_on_threshold with a minimum gap of 0.001.'
      );
    }

    // 2. Database transaction to create the pending record
    let pendingConfig: DeviceTuningConfiguration;
    try {
      pendingConfig = await this.dataSource.transaction(async (manager) => {
        // Ownership Check: verify that the device exists
        const device = await manager.findOne(Device, { where: { deviceId } });
        if (!device) {
          throw new NotFoundException(`Device '${deviceId}' not found.`);
        }
        if (!device.enabled) {
          throw new BadRequestException(`Device '${deviceId}' is disabled.`);
        }

        // Idempotency check: see if command already exists
        const existing = await manager.findOne(DeviceTuningConfiguration, {
          where: { commandId, deviceId },
        });
        if (existing) {
          this.logger.log(`Command '${commandId}' for device '${deviceId}' already exists. Returning existing command.`);
          return existing;
        }

        // Get the latest IN_SYNC config as configBefore for the audit log
        const prevConfig = await manager.findOne(DeviceTuningConfiguration, {
          where: { deviceId, status: SyncStatus.IN_SYNC },
          order: { createdAt: 'DESC' },
        });
        const configBefore = prevConfig ? prevConfig.config : null;

        // Calculate next revision
        const lastAnyConfig = await manager.findOne(DeviceTuningConfiguration, {
          where: { deviceId },
          order: { createdAt: 'DESC' },
        });
        const revision = lastAnyConfig ? lastAnyConfig.revision + 1 : 1;

        // Create new pending configuration
        const newConfig = manager.create(DeviceTuningConfiguration, {
          id: crypto.randomUUID(),
          deviceId,
          commandId,
          revision,
          status: SyncStatus.PENDING,
          config: inputConfig,
          publishedAt: null,
        });
        const savedConfig = await manager.save(DeviceTuningConfiguration, newConfig);

        // Save audit log for CREATE_PENDING
        const auditLog = manager.create(TuningAuditLog, {
          id: crypto.randomUUID(),
          configurationId: savedConfig.id,
          deviceId,
          actor,
          source: 'api',
          action: 'CREATE_PENDING',
          rulesetVersion: null,
          kpiSnapshot: null,
          configBefore,
          configAfter: inputConfig,
          reason: 'Create pending tuning command',
          result: 'SUCCESS',
        });
        await manager.save(TuningAuditLog, auditLog);

        return savedConfig;
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Database transaction failed while creating pending command: ${error instanceof Error ? error.message : String(error)}`);
      throw new InternalServerErrorException('Failed to create pending tuning command due to database error.');
    }

    // If existing command was found and is already published or processed, return it directly (idempotency case)
    if (pendingConfig.publishedAt !== null || pendingConfig.status !== SyncStatus.PENDING) {
      return pendingConfig;
    }

    // 3. Publish to MQTT with retry or error handling strategy
    try {
      await this.mqttService.publishTuningDesired(deviceId, commandId, inputConfig);

      // 4. Update publish time on success
      pendingConfig.publishedAt = new Date();
      pendingConfig.updatedAt = new Date();
      await this.configRepo.save(pendingConfig);

      // Emit SSE Event
      this.tuningSync$.next({
        id: pendingConfig.id,
        deviceId: pendingConfig.deviceId,
        commandId: pendingConfig.commandId,
        revision: pendingConfig.revision,
        status: pendingConfig.status,
        config: pendingConfig.config,
        publishedAt: pendingConfig.publishedAt.toISOString(),
        createdAt: pendingConfig.createdAt.toISOString(),
        updatedAt: pendingConfig.updatedAt.toISOString(),
      });

      return pendingConfig;
    } catch (error) {
      this.logger.error(
        `Failed to publish tuning command via MQTT for device '${deviceId}': ${error instanceof Error ? error.message : String(error)}`
      );

      // Handle publish error: update status to REJECTED and write a FAILED audit log
      try {
        await this.dataSource.transaction(async (manager) => {
          await manager.update(DeviceTuningConfiguration, { id: pendingConfig.id }, {
            status: SyncStatus.REJECTED,
            updatedAt: new Date(),
          });

          // Save failed audit log
          const failAudit = manager.create(TuningAuditLog, {
            id: crypto.randomUUID(),
            configurationId: pendingConfig.id,
            deviceId,
            actor,
            source: 'api',
            action: 'PUBLISH_FAILED',
            rulesetVersion: null,
            kpiSnapshot: null,
            configBefore: null,
            configAfter: inputConfig,
            reason: `MQTT Publish Error: ${error instanceof Error ? error.message : String(error)}`,
            result: 'FAILED',
          });
          await manager.save(TuningAuditLog, failAudit);
        });

        // Update local copy status for returning
        pendingConfig.status = SyncStatus.REJECTED;
      } catch (dbError) {
        this.logger.error(`Critical: Failed to save publish error audit log for device '${deviceId}': ${dbError instanceof Error ? dbError.message : String(dbError)}`);
      }

      throw new InternalServerErrorException(
        `Failed to publish tuning command to device: ${error instanceof Error ? error.message : 'Unknown MQTT error'}`
      );
    }
  }

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
