import {
  BadRequestException,
} from '@nestjs/common';
import { AnalyticsAvailabilityService } from '../../influx/services/analytics-availability.service';
import type { KpiMetrics } from '../../analytics/interfaces/kpi-metrics.interface';
import { ControlAnalyticsService } from '../../analytics/services/control-analytics.service';
import { TuningRecommenderEngine } from '../../analytics/services/tuning-recommender-engine.service';
import type { TuningConfigSnapshot } from '../entities/device-tuning-configuration.entity';
import { TuningConfigurationService } from '../services/tuning-configuration.service';
import { TuningRecommendationController } from './tuning-recommendation.controller';

describe('TuningRecommendationController', () => {
  const checkDeviceOnline = jest.fn();
  const getKpiForDevice = jest.fn();
  const checkCoverageGate = jest.fn();
  const analyticsService = {
    checkDeviceOnline,
    getKpiForDevice,
    checkCoverageGate,
  } as unknown as ControlAnalyticsService;
  const generateRecommendation = jest.fn();
  const recommenderEngine = {
    generateRecommendation,
  } as unknown as TuningRecommenderEngine;
  const getLatestByDeviceId = jest.fn();
  const tuningConfigurationService = {
    getLatestByDeviceId,
  } as unknown as TuningConfigurationService;
  const analyticsAvailability = {
    getState: jest.fn(() => ({ available: true, reason: null })),
  } as unknown as AnalyticsAvailabilityService;
  const controller = new TuningRecommendationController(
    analyticsService,
    recommenderEngine,
    tuningConfigurationService,
    analyticsAvailability,
  );

  const kpi: KpiMetrics = {
    deviceId: 'device-1',
    windowStart: new Date('2026-07-25T00:00:00.000Z'),
    windowEnd: new Date('2026-07-26T00:00:00.000Z'),
    tempRmse: 2,
    humidRmse: 3,
    mistSwitchCountPerHour: 4,
    mistOnDurationSec: 60,
    lampDutyCyclePercent: 25,
    lampAvgOnDurationSec: 20,
    overshootDurationSec: 10,
    undershootDurationSec: 5,
    dataCoveragePercent: 90,
    sampleCount: 648,
    configRevision: 7,
    dataQualityWarning: false,
  };
  const config: TuningConfigSnapshot = {
    lamp_gain_scale: 1,
    mist_gain_scale: 1,
    mist_on_threshold: 0.25,
    mist_off_threshold: 0.15,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    checkDeviceOnline.mockResolvedValue(true);
    getKpiForDevice.mockResolvedValue(kpi);
    checkCoverageGate.mockReturnValue({ allowed: true });
    getLatestByDeviceId.mockResolvedValue({
      config,
    });
    (analyticsAvailability.getState as jest.Mock).mockReturnValue({
      available: true,
      reason: null,
    });
  });

  it('returns a blocked response before querying other systems when analytics is degraded', async () => {
    (analyticsAvailability.getState as jest.Mock).mockReturnValue({
      available: false,
      reason: 'INFLUXDB_ANALYTICS_BUCKET is missing',
    });

    await expect(
      controller.getTuningRecommendations('device-1', '24'),
    ).resolves.toMatchObject({
      deviceId: 'device-1',
      kpi: null,
      currentConfig: null,
      advisory: null,
      blockReason: 'INSUFFICIENT_DATA',
      blockReasonDetail:
        'Tuning recommendations are temporarily unavailable: INFLUXDB_ANALYTICS_BUCKET is missing',
    });
    expect(checkDeviceOnline).not.toHaveBeenCalled();
    expect(getKpiForDevice).not.toHaveBeenCalled();
  });

  it('uses the default 24-hour window and returns a safe advisory response', async () => {
    const advisory = {
      rulesetVersion: 'v1.0.0',
      currentConfig: config,
      suggestedConfig: { ...config, lamp_gain_scale: 1.05 },
      delta: { lamp_gain_scale: 1.05 },
      triggeredRules: ['R2_TEMP_HIGH_LAMP_LOW'],
      confidence: 'MEDIUM' as const,
      expectedBenefit: 'Improve temperature tracking.',
      kpiSnapshot: kpi,
      observationWindowRequired: true,
    };
    generateRecommendation.mockReturnValue({
      status: 'ADVISORY',
      advisory,
    });

    const response = await controller.getTuningRecommendations(
      'device-1',
      undefined,
    );

    expect(getKpiForDevice).toHaveBeenCalledWith('device-1', 24);
    expect(response).toMatchObject({
      deviceId: 'device-1',
      kpi,
      currentConfig: config,
      advisory,
      blockReason: null,
      blockReasonDetail: null,
    });
    expect(new Date(response.generatedAt).toISOString()).toBe(
      response.generatedAt,
    );
  });

  it.each(['0', '169', '1.5', '-1', 'abc', ' 24', '24 '])(
    'rejects a malformed or out-of-range window of %s',
    async (window) => {
      await expect(
        controller.getTuningRecommendations('device-1', window),
      ).rejects.toThrow(BadRequestException);
      expect(checkDeviceOnline).not.toHaveBeenCalled();
    },
  );

  it('blocks offline devices before reading KPI or configuration data', async () => {
    checkDeviceOnline.mockResolvedValue(false);

    await expect(
      controller.getTuningRecommendations('device-1', '168'),
    ).resolves.toMatchObject({
      deviceId: 'device-1',
      kpi: null,
      currentConfig: null,
      advisory: null,
      blockReason: 'DEVICE_OFFLINE',
    });
    expect(getKpiForDevice).not.toHaveBeenCalled();
    expect(getLatestByDeviceId).not.toHaveBeenCalled();
  });

  it('blocks when no KPI is available before invoking the recommender', async () => {
    getKpiForDevice.mockResolvedValue(null);

    await expect(
      controller.getTuningRecommendations('device-1', '1'),
    ).resolves.toMatchObject({
      kpi: null,
      currentConfig: null,
      advisory: null,
      blockReason: 'INSUFFICIENT_DATA',
    });
    expect(checkCoverageGate).not.toHaveBeenCalled();
    expect(generateRecommendation).not.toHaveBeenCalled();
  });

  it('blocks a failed coverage gate without returning or generating an advisory', async () => {
    checkCoverageGate.mockReturnValue({
      allowed: false,
      reason: 'COVERAGE_BELOW_80_PERCENT',
    });

    await expect(
      controller.getTuningRecommendations('device-1', '24'),
    ).resolves.toMatchObject({
      kpi,
      currentConfig: null,
      advisory: null,
      blockReason: 'INSUFFICIENT_DATA',
      blockReasonDetail:
        'KPI coverage is below the required 80 percent threshold.',
    });
    expect(getLatestByDeviceId).not.toHaveBeenCalled();
    expect(generateRecommendation).not.toHaveBeenCalled();
  });

  it('maps a recommender conflict to a public blocked response', async () => {
    generateRecommendation.mockReturnValue({
      status: 'CONFLICT',
      conflictingRules: ['R1_MIST_CHATTERING', 'R3_HUMID_HIGH_MIST_OK'],
    });

    await expect(
      controller.getTuningRecommendations('device-1', '24'),
    ).resolves.toMatchObject({
      kpi,
      currentConfig: config,
      advisory: null,
      blockReason: 'CONFLICT',
      blockReasonDetail:
        'Conflicting tuning rules: R1_MIST_CHATTERING, R3_HUMID_HIGH_MIST_OK.',
    });
  });
});
