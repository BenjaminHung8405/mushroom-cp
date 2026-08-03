import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { KpiMetrics } from '../../analytics/interfaces/kpi-metrics.interface';
import type { TuningAdvisory } from '../../analytics/interfaces/tuning-advisory.interface';
import type { TuningConfigSnapshot } from '../entities/device-tuning-configuration.entity';
import {
  TuningRecommendation,
  TuningRecommendationStatus,
} from '../entities/tuning-recommendation.entity';

export interface UpsertDailyRecommendationInput {
  deviceId: string;
  observationDate: string;
  status: TuningRecommendationStatus;
  rawKpiSnapshot: KpiMetrics | null;
  currentConfigSnapshot: TuningConfigSnapshot | null;
  advisorySnapshot: TuningAdvisory | null;
  blockReason?: string | null;
  blockReasonDetail?: string | null;
}

@Injectable()
export class TuningRecommendationService {
  constructor(
    @InjectRepository(TuningRecommendation)
    private readonly repository: Repository<TuningRecommendation>,
  ) {}

  async findByDeviceAndDate(deviceId: string, observationDate: string) {
    return this.repository.findOne({ where: { deviceId, observationDate } });
  }

  async upsertDailyRecommendation(input: UpsertDailyRecommendationInput) {
    const values = {
      ...input,
      rawKpiSnapshot: input.rawKpiSnapshot as unknown as Record<string, unknown> | null,
      currentConfigSnapshot: input.currentConfigSnapshot as unknown as Record<string, unknown> | null,
      advisorySnapshot: input.advisorySnapshot as unknown as Record<string, unknown> | null,
      blockReason: input.blockReason ?? null,
      blockReasonDetail: input.blockReasonDetail ?? null,
      generatedAt: new Date(),
    };
    await this.repository.query(
      `INSERT INTO tuning_recommendations
        (device_id, observation_date, status, block_reason, block_reason_detail,
         raw_kpi_snapshot, current_config_snapshot, advisory_snapshot, generated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)
       ON CONFLICT (device_id, observation_date) DO UPDATE SET
         status = EXCLUDED.status,
         block_reason = EXCLUDED.block_reason,
         block_reason_detail = EXCLUDED.block_reason_detail,
         raw_kpi_snapshot = EXCLUDED.raw_kpi_snapshot,
         current_config_snapshot = EXCLUDED.current_config_snapshot,
         advisory_snapshot = EXCLUDED.advisory_snapshot,
         generated_at = EXCLUDED.generated_at
       WHERE tuning_recommendations.status <> 'APPLIED'`,
      [
        input.deviceId,
        input.observationDate,
        input.status,
        values.blockReason,
        values.blockReasonDetail,
        JSON.stringify(values.rawKpiSnapshot),
        JSON.stringify(values.currentConfigSnapshot),
        JSON.stringify(values.advisorySnapshot),
        values.generatedAt,
      ],
    );
    const saved = await this.findByDeviceAndDate(input.deviceId, input.observationDate);
    if (!saved) throw new Error('Tuning recommendation upsert did not return a row.');
    return saved;
  }

  async markAppliedForConfiguration(deviceId: string, configurationId: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(TuningRecommendation)
      .set({
        status: TuningRecommendationStatus.APPLIED,
        appliedConfigurationId: configurationId,
        appliedAt: new Date(),
      })
      .where('device_id = :deviceId', { deviceId })
      .andWhere('status = :status', { status: TuningRecommendationStatus.PENDING })
      .andWhere("advisory_snapshot IS NOT NULL")
      .execute();
  }
}
