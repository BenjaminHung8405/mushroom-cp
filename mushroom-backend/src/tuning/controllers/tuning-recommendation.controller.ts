import { Controller, Get, Param } from '@nestjs/common';
import { TuningObservationClockService, TUNING_TIMEZONE } from '../services/tuning-observation-clock.service';
import { TuningRecommendationService } from '../services/tuning-recommendation.service';
import { TuningRecommendationStatus } from '../entities/tuning-recommendation.entity';
import { TuningRecommendationResponseDto } from '../dtos/tuning-recommendation-response.dto';

@Controller('devices')
export class TuningRecommendationController {
  constructor(
    private readonly recommendations: TuningRecommendationService,
    private readonly clock: TuningObservationClockService,
  ) {}

  @Get(':id/analytics/tuning-recommendations')
  async getTuningRecommendations(@Param('id') deviceId: string): Promise<TuningRecommendationResponseDto> {
    const observationDate = this.clock.getCurrentObservationDate();
    const row = await this.recommendations.findByDeviceAndDate(deviceId, observationDate);
    if (!row) return this.missing(deviceId, observationDate);
    return {
      deviceId,
      kpi: row.rawKpiSnapshot as TuningRecommendationResponseDto['kpi'],
      currentConfig: row.currentConfigSnapshot as TuningRecommendationResponseDto['currentConfig'],
      advisory: row.advisorySnapshot as TuningRecommendationResponseDto['advisory'],
      blockReason: row.blockReason as TuningRecommendationResponseDto['blockReason'],
      blockReasonDetail: row.blockReasonDetail,
      generatedAt: row.generatedAt.toISOString(),
      observationDate,
      source: 'DAILY_SNAPSHOT',
      windowHours: 24,
      timezone: TUNING_TIMEZONE,
      status: row.status,
    };
  }

  private missing(deviceId: string, observationDate: string): TuningRecommendationResponseDto {
    return { deviceId, kpi: null, currentConfig: null, advisory: null, blockReason: 'INSUFFICIENT_DATA', blockReasonDetail: 'Daily advisory snapshot has not been generated yet.', generatedAt: new Date().toISOString(), observationDate, source: 'DAILY_SNAPSHOT', windowHours: 24, timezone: TUNING_TIMEZONE, status: TuningRecommendationStatus.INSUFFICIENT_DATA };
  }
}
