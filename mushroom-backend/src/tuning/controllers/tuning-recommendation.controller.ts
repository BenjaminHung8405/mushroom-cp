import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ControlAnalyticsService,
  type CoverageGateFailureReason,
} from '../../analytics/services/control-analytics.service';
import { TuningRecommenderEngine } from '../../analytics/services/tuning-recommender-engine.service';
import type { RecommendationResult } from '../../analytics/interfaces/tuning-advisory.interface';
import { DeviceOwnershipGuard } from '../guards/device-ownership.guard';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import {
  TuningRecommendationResponseDto,
  type TuningRecommendationBlockReason,
} from '../dtos/tuning-recommendation-response.dto';
import { TuningConfigurationService } from '../services/tuning-configuration.service';

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 168;

@Controller('devices')
export class TuningRecommendationController {
  constructor(
    private readonly analyticsService: ControlAnalyticsService,
    private readonly recommenderEngine: TuningRecommenderEngine,
    private readonly tuningConfigurationService: TuningConfigurationService,
  ) {}

  @Get(':id/analytics/tuning-recommendations')
  @UseGuards(JwtAuthGuard, DeviceOwnershipGuard)
  async getTuningRecommendations(
    @Param('id') deviceId: string,
    @Query('window') window: string | undefined,
  ): Promise<TuningRecommendationResponseDto> {
    const windowHours = parseWindowHours(window);
    const generatedAt = new Date().toISOString();

    if (!(await this.analyticsService.checkDeviceOnline(deviceId))) {
      return this.blocked(
        deviceId,
        generatedAt,
        null,
        null,
        'DEVICE_OFFLINE',
        'The device has not reported telemetry within the last five minutes.',
      );
    }

    const kpi = await this.analyticsService.getKpiForDevice(
      deviceId,
      windowHours,
    );
    if (kpi === null) {
      return this.blocked(
        deviceId,
        generatedAt,
        null,
        null,
        'INSUFFICIENT_DATA',
        'No valid KPI data is available for the requested observation window.',
      );
    }

    const coverageGate = this.analyticsService.checkCoverageGate(kpi);
    if (!coverageGate.allowed) {
      return this.blocked(
        deviceId,
        generatedAt,
        kpi,
        null,
        'INSUFFICIENT_DATA',
        coverageGateDetail(coverageGate.reason),
      );
    }

    const currentConfiguration =
      await this.tuningConfigurationService.getLatestByDeviceId(deviceId);
    if (currentConfiguration === null) {
      return this.blocked(
        deviceId,
        generatedAt,
        kpi,
        null,
        'INSUFFICIENT_DATA',
        'No durable tuning configuration is available for this device.',
      );
    }

    return this.fromRecommendationResult(
      deviceId,
      generatedAt,
      kpi,
      currentConfiguration.config,
      this.recommenderEngine.generateRecommendation(
        kpi,
        currentConfiguration.config,
      ),
    );
  }

  private fromRecommendationResult(
    deviceId: string,
    generatedAt: string,
    kpi: TuningRecommendationResponseDto['kpi'],
    currentConfig: NonNullable<
      TuningRecommendationResponseDto['currentConfig']
    >,
    result: RecommendationResult,
  ): TuningRecommendationResponseDto {
    switch (result.status) {
      case 'ADVISORY':
        return {
          deviceId,
          kpi,
          currentConfig,
          advisory: result.advisory,
          blockReason: null,
          blockReasonDetail: null,
          generatedAt,
        };
      case 'INSUFFICIENT_DATA':
      case 'NO_SUGGESTION':
        return this.blocked(
          deviceId,
          generatedAt,
          kpi,
          currentConfig,
          result.status,
          result.reason,
        );
      case 'CONFLICT':
        return this.blocked(
          deviceId,
          generatedAt,
          kpi,
          currentConfig,
          'CONFLICT',
          `Conflicting tuning rules: ${result.conflictingRules.join(', ')}.`,
        );
    }
  }

  private blocked(
    deviceId: string,
    generatedAt: string,
    kpi: TuningRecommendationResponseDto['kpi'],
    currentConfig: TuningRecommendationResponseDto['currentConfig'],
    blockReason: TuningRecommendationBlockReason,
    blockReasonDetail: string,
  ): TuningRecommendationResponseDto {
    return {
      deviceId,
      kpi,
      currentConfig,
      advisory: null,
      blockReason,
      blockReasonDetail,
      generatedAt,
    };
  }
}

function parseWindowHours(value: string | undefined): number {
  if (value === undefined) return DEFAULT_WINDOW_HOURS;
  if (!/^\d+$/u.test(value)) {
    throw new BadRequestException('window must be an integer number of hours.');
  }

  const windowHours = Number(value);
  if (
    !Number.isSafeInteger(windowHours) ||
    windowHours < 1 ||
    windowHours > MAX_WINDOW_HOURS
  ) {
    throw new BadRequestException(
      `window must be between 1 and ${MAX_WINDOW_HOURS} hours.`,
    );
  }
  return windowHours;
}

function coverageGateDetail(reason: CoverageGateFailureReason): string {
  switch (reason) {
    case 'COVERAGE_BELOW_80_PERCENT':
      return 'KPI coverage is below the required 80 percent threshold.';
    case 'INSUFFICIENT_TRUSTED_SAMPLES':
      return 'The KPI window does not contain enough trusted samples.';
    case 'CONFIG_REVISION_UNAVAILABLE':
      return 'The KPI window does not have one unambiguous configuration revision.';
    case 'INVALID_KPI_DATA':
      return 'The KPI data failed integrity validation.';
  }
}
