import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Device } from '../../device/entities/device.entity';
import { ControlAnalyticsService } from '../../analytics/services/control-analytics.service';
import { TuningRecommenderEngine } from '../../analytics/services/tuning-recommender-engine.service';
import { TuningConfigurationService } from './tuning-configuration.service';
import { TuningObservationClockService } from './tuning-observation-clock.service';
import { TuningRecommendationService } from './tuning-recommendation.service';
import { TuningRecommendationStatus } from '../entities/tuning-recommendation.entity';

@Injectable()
export class TuningAdvisoryCronService {
  private readonly logger = new Logger(TuningAdvisoryCronService.name);
  constructor(
    private readonly dataSource: DataSource,
    private readonly clock: TuningObservationClockService,
    private readonly analytics: ControlAnalyticsService,
    private readonly engine: TuningRecommenderEngine,
    private readonly configurations: TuningConfigurationService,
    private readonly recommendations: TuningRecommendationService,
  ) {}

  @Cron('5 0 * * *', {
    name: 'daily-tuning-advisory',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async runDaily(): Promise<void> {
    await this.run();
  }

  async run(now = new Date()): Promise<void> {
    const window = this.clock.getCompletedDay(now);
    const lockKey = `daily-tuning-advisory:${window.observationDate}`;
    const lock = await this.dataSource.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
      [lockKey],
    );
    if (!lock[0]?.locked) {
      this.logger.log(
        `daily advisory skipped; lock held date=${window.observationDate}`,
      );
      return;
    }
    const devices = await this.dataSource
      .getRepository(Device)
      .find({ where: { enabled: true } });
    try {
      for (const device of devices)
        await this.processDevice(
          device.deviceId,
          window.observationDate,
          window.from,
          window.to,
        );
    } finally {
      await this.dataSource.query('SELECT pg_advisory_unlock(hashtext($1))', [
        lockKey,
      ]);
    }
  }

  private async processDevice(
    deviceId: string,
    observationDate: string,
    from: Date,
    to: Date,
  ): Promise<void> {
    try {
      const kpi = await this.retry(() =>
        this.analytics.getKpiForDeviceInWindow(deviceId, from, to),
      );
      const gate = kpi
        ? this.analytics.checkCoverageGate(kpi)
        : { allowed: false as const, reason: 'INSUFFICIENT_DATA' as const };
      if (!kpi || !gate.allowed) {
        await this.recommendations.upsertDailyRecommendation({
          deviceId,
          observationDate,
          status: TuningRecommendationStatus.INSUFFICIENT_DATA,
          rawKpiSnapshot: kpi,
          currentConfigSnapshot: null,
          advisorySnapshot: null,
          blockReason: 'INSUFFICIENT_DATA',
          blockReasonDetail:
            'KPI coverage or integrity requirements were not satisfied.',
        });
        return;
      }
      const current = await this.configurations.getLatestByDeviceId(deviceId);
      const result = this.engine.generateRecommendation(
        kpi,
        current?.config ?? null,
      );
      const advisory = result.status === 'ADVISORY' ? result.advisory : null;
      const reason = result.status === 'ADVISORY' ? null : result.status;
      const detail =
        result.status === 'CONFLICT'
          ? result.conflictingRules.join(', ')
          : result.status === 'ADVISORY'
            ? null
            : result.reason;
      await this.recommendations.upsertDailyRecommendation({
        deviceId,
        observationDate,
        status: TuningRecommendationStatus.PENDING,
        rawKpiSnapshot: kpi,
        currentConfigSnapshot: current?.config ?? null,
        advisorySnapshot: advisory,
        blockReason: reason,
        blockReasonDetail: detail,
      });
    } catch (error) {
      this.logger.error(
        `daily advisory failed device=${deviceId} date=${observationDate}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async retry<T>(operation: () => Promise<T>): Promise<T> {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1)
      try {
        return await operation();
      } catch (error) {
        last = error;
        if (attempt < 2)
          await new Promise((resolve) =>
            setTimeout(resolve, 100 * 2 ** attempt),
          );
      }
    throw last;
  }
}
