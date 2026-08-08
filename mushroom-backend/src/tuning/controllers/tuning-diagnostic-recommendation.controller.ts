import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ControlAnalyticsService } from '../../analytics/services/control-analytics.service';
import { TuningRecommenderEngine } from '../../analytics/services/tuning-recommender-engine.service';
import { TuningConfigurationService } from '../services/tuning-configuration.service';
import {
  TuningObservationClockService,
  TUNING_TIMEZONE,
} from '../services/tuning-observation-clock.service';
import type { TuningRecommendationResponseDto } from '../dtos/tuning-recommendation-response.dto';

@Controller('devices')
export class TuningDiagnosticRecommendationController {
  private readonly logger = new Logger(
    TuningDiagnosticRecommendationController.name,
  );
  constructor(
    private readonly analytics: ControlAnalyticsService,
    private readonly engine: TuningRecommenderEngine,
    private readonly configurations: TuningConfigurationService,
    private readonly clock: TuningObservationClockService,
  ) {}

  @Get(':id/analytics/diagnostic-recommendations')
  async getDiagnostic(
    @Param('id') deviceId: string,
    @Query('window') window = '24',
  ): Promise<TuningRecommendationResponseDto> {
    if (!/^\d+$/.test(window) || Number(window) < 1 || Number(window) > 168)
      throw new BadRequestException('window must be between 1 and 168 hours.');
    const hours = Number(window);
    const end = new Date();
    const start = new Date(end.getTime() - hours * 3_600_000);
    const kpi = await this.analytics.getKpiForDeviceInWindow(
      deviceId,
      start,
      end,
    );
    const current = await this.configurations.getLatestByDeviceId(deviceId);
    const result = this.analytics.checkCoverageGate(kpi!);
    const recommendation =
      kpi && result.allowed
        ? this.engine.generateRecommendation(kpi, current?.config ?? null)
        : null;
    this.logger.log(
      `diagnostic recommendation read device=${deviceId} window=${hours}h`,
    );
    return {
      deviceId,
      kpi,
      currentConfig: current?.config ?? null,
      advisory:
        recommendation?.status === 'ADVISORY' ? recommendation.advisory : null,
      blockReason:
        recommendation?.status === 'CONFLICT'
          ? 'CONFLICT'
          : recommendation?.status === 'NO_SUGGESTION'
            ? 'NO_SUGGESTION'
            : !kpi || !result.allowed
              ? 'INSUFFICIENT_DATA'
              : null,
      blockReasonDetail:
        recommendation?.status === 'CONFLICT'
          ? recommendation.conflictingRules.join(', ')
          : recommendation?.status === 'NO_SUGGESTION'
            ? recommendation.reason
            : null,
      generatedAt: new Date().toISOString(),
      observationDate: this.clock.getCurrentObservationDate(),
      source: 'DIAGNOSTIC',
      windowHours: hours,
      timezone: TUNING_TIMEZONE,
    };
  }
}
