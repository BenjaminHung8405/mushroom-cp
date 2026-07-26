import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { QueryApi } from '@influxdata/influxdb-client';
import { AnalyticsModule } from '../analytics.module';
import { ConfigService } from '../../influx/services/config.service';
import { InfluxDbService } from '../../influx/services/influx-db.service';
import { InfluxModule } from '../../influx/influx.module';
import {
  ControlAnalyticsService,
  escapeFluxString,
} from './control-analytics.service';

describe('ControlAnalyticsService', () => {
  const collectRows = jest.fn<Promise<FluxRow[]>, [string]>();
  const queryApi = {
    collectRows,
  };
  const influxDbService = {
    getQueryApi: jest.fn<QueryApi | null, []>(
      () => queryApi as unknown as QueryApi,
    ),
  };
  const configService = {
    get: jest.fn<string | undefined, [string]>(defaultConfigValue),
  };
  const service = new ControlAnalyticsService(
    influxDbService as unknown as InfluxDbService,
    configService,
  );
  const now = new Date('2026-07-25T12:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    configService.get.mockImplementation(defaultConfigValue);
  });

  describe('checkCoverageGate', () => {
    it('blocks coverage below 80 percent before evaluating other gates', () => {
      expect(
        service.checkCoverageGate(kpiForGate({ dataCoveragePercent: 79.99 })),
      ).toEqual({
        allowed: false,
        reason: 'COVERAGE_BELOW_80_PERCENT',
      });
    });

    it('blocks mixed quality with fewer than 100 trusted samples', () => {
      expect(
        service.checkCoverageGate(
          kpiForGate({
            dataQualityWarning: true,
            sampleCount: 99,
          }),
        ),
      ).toEqual({
        allowed: false,
        reason: 'INSUFFICIENT_TRUSTED_SAMPLES',
      });
    });

    it('allows mixed quality when at least 100 trusted samples are available', () => {
      expect(
        service.checkCoverageGate(
          kpiForGate({
            dataQualityWarning: true,
            sampleCount: 100,
          }),
        ),
      ).toEqual({ allowed: true });
    });

    it('blocks a KPI without an unambiguous config revision', () => {
      expect(
        service.checkCoverageGate(kpiForGate({ configRevision: null })),
      ).toEqual({
        allowed: false,
        reason: 'CONFIG_REVISION_UNAVAILABLE',
      });
    });

    it('allows a complete KPI window', () => {
      expect(service.checkCoverageGate(kpiForGate())).toEqual({
        allowed: true,
      });
    });

    it.each([
      { dataCoveragePercent: Number.NaN },
      { dataCoveragePercent: 100.01 },
      { tempRmse: Number.POSITIVE_INFINITY },
      { sampleCount: 1.5 },
    ])('fails closed for malformed KPI values: %o', (overrides) => {
      expect(service.checkCoverageGate(kpiForGate(overrides))).toEqual({
        allowed: false,
        reason: 'INVALID_KPI_DATA',
      });
    });
  });

  it('resolves ControlAnalyticsService through the Nest AnalyticsModule', async () => {
    @Module({
      providers: [
        { provide: InfluxDbService, useValue: influxDbService },
        { provide: ConfigService, useValue: configService },
      ],
      exports: [InfluxDbService, ConfigService],
    })
    class MockInfluxModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [AnalyticsModule],
    })
      .overrideModule(InfluxModule)
      .useModule(MockInfluxModule)
      .compile();

    expect(moduleRef.get(ControlAnalyticsService)).toBeInstanceOf(
      ControlAnalyticsService,
    );
    await moduleRef.close();
  });

  it('aggregates rolling KPI using total squared error and total samples', async () => {
    queryApi.collectRows.mockResolvedValue([
      hourlyRow({
        sample_count: 100,
        sum_squared_error_temp: 100,
        sum_squared_error_humid: 400,
        mist_switch_count: 10,
        mist_on_duration_s: 500,
        lamp_on_duration_s: 1_800,
        lamp_session_count: 2,
        expected_samples: 120,
        valid_samples: 100,
        config_revision: '7',
      }),
      hourlyRow({
        sample_count: 300,
        sum_squared_error_temp: 300,
        sum_squared_error_humid: 500,
        mist_switch_count: 14,
        mist_on_duration_s: 1_500,
        lamp_on_duration_s: 3_600,
        lamp_session_count: 3,
        expected_samples: 360,
        valid_samples: 300,
        config_revision: '7',
      }),
    ]);

    await expect(service.getKpiForDevice('device-1', 2, now)).resolves.toEqual({
      deviceId: 'device-1',
      windowStart: new Date('2026-07-25T10:00:00.000Z'),
      windowEnd: now,
      tempRmse: Math.sqrt(400 / 400),
      humidRmse: Math.sqrt(900 / 400),
      mistSwitchCountPerHour: 12,
      mistOnDurationSec: 2_000,
      lampDutyCyclePercent: (5_400 / 7_200) * 100,
      lampAvgOnDurationSec: 1_080,
      overshootDurationSec: 10,
      undershootDurationSec: 10,
      dataCoveragePercent: (400 / (2 * 720)) * 100,
      sampleCount: 400,
      configRevision: 7,
      dataQualityWarning: false,
    });

    const flux = latestFluxQuery(collectRows);
    expect(flux).toContain('bucket: "analytics_bucket"');
    expect(flux).toContain('device_id"] == "device-1"');
    expect(flux).not.toContain('aggregateWindow');
  });

  it('escapes a device id before putting it in Flux', async () => {
    queryApi.collectRows.mockResolvedValue([]);
    const deviceId = 'device\\"-1';

    await expect(
      service.getKpiForDevice(deviceId, 24, now),
    ).resolves.toBeNull();

    const flux = latestFluxQuery(collectRows);
    expect(flux).toContain(`device_id"] == "${escapeFluxString(deviceId)}"`);
    expect(flux).not.toContain(deviceId);
  });

  it.each([null, {}, '   '])(
    'rejects invalid device identifiers with BadRequestException and INVALID_DEVICE_ID reason: %o',
    async (value) => {
      let error: unknown;
      try {
        await service.getKpiForDevice(value as unknown as string, 24, now);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect(
        (
          (error as BadRequestException).getResponse() as Record<
            string,
            unknown
          >
        ).reason,
      ).toBe('INVALID_DEVICE_ID');
      expect(queryApi.collectRows).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 169, 2.5])(
    'rejects invalid window hours with BadRequestException and INVALID_WINDOW reason: %o',
    async (windowHours) => {
      let error: unknown;
      try {
        await service.getKpiForDevice('device-1', windowHours, now);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect(
        (
          (error as BadRequestException).getResponse() as Record<
            string,
            unknown
          >
        ).reason,
      ).toBe('INVALID_WINDOW');
      expect(queryApi.collectRows).not.toHaveBeenCalled();
    },
  );

  it.each([new Date('invalid'), { getTime: () => now.getTime() }, null])(
    'rejects invalid clock values with BadRequestException and INVALID_TIMESTAMP reason: %o',
    async (value) => {
      let error: unknown;
      try {
        await service.getKpiForDevice('device-1', 24, value as unknown as Date);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getStatus()).toBe(400);
      expect(
        (
          (error as BadRequestException).getResponse() as Record<
            string,
            unknown
          >
        ).reason,
      ).toBe('INVALID_TIMESTAMP');
      expect(queryApi.collectRows).not.toHaveBeenCalled();
    },
  );

  it('returns null when all rows are absent or invalid', async () => {
    queryApi.collectRows.mockResolvedValue([
      { sample_count: 0, expected_samples: 0 },
    ]);

    await expect(
      service.getKpiForDevice('device-1', 24, now),
    ).resolves.toBeNull();
  });

  it('counts missing hourly KPI rows against the complete rolling window', async () => {
    queryApi.collectRows.mockResolvedValue([
      hourlyRow({
        sample_count: 720,
        sum_squared_error_temp: 720,
        sum_squared_error_humid: 720,
        mist_switch_count: 0,
        mist_on_duration_s: 0,
        lamp_on_duration_s: 0,
        lamp_session_count: 0,
        expected_samples: 720,
        valid_samples: 720,
      }),
    ]);

    const kpi = await service.getKpiForDevice('device-1', 24, now);

    expect(kpi?.dataCoveragePercent).toBeCloseTo((720 / (24 * 720)) * 100);
    expect(service.checkCoverageGate(kpi!)).toEqual({
      allowed: false,
      reason: 'COVERAGE_BELOW_80_PERCENT',
    });
  });

  it('rejects the whole response when any hourly KPI row is malformed', async () => {
    queryApi.collectRows.mockResolvedValue([
      hourlyRow(),
      hourlyRow({ valid_samples: 721, expected_samples: 720 }),
    ]);

    await expect(
      service.getKpiForDevice('device-1', 24, now),
    ).resolves.toBeNull();
  });

  it('rejects the whole response when a numeric metric is a string', async () => {
    queryApi.collectRows.mockResolvedValue([
      hourlyRow(),
      hourlyRow({ expected_samples: '720' }),
    ]);

    const kpi = await service.getKpiForDevice('device-1', 24, now);

    expect(kpi).toBeNull();
    expect(kpi === null ? null : service.checkCoverageGate(kpi)).toBeNull();
  });

  it.each([
    { sample_count: 13, valid_samples: 12, expected_samples: 12 },
    { sample_count: 13, valid_samples: 13, expected_samples: 12 },
    { sample_count: 0, valid_samples: 0, expected_samples: 0 },
    { sample_count: Number.MAX_VALUE },
    { sum_squared_error_temp: Number.MAX_VALUE },
    { sample_count: 721 },
    { expected_samples: 720, valid_samples: 721 },
    { lamp_on_duration_s: 3_601 },
    { mist_on_duration_s: 3_601 },
    { sum_squared_error_temp: -1 },
  ])('rejects malformed hourly KPI rows: %o', async (overrides) => {
    queryApi.collectRows.mockResolvedValue([hourlyRow(overrides)]);

    await expect(
      service.getKpiForDevice('device-1', 24, now),
    ).resolves.toBeNull();
  });

  it('rejects totals that would overflow during rolling accumulation', async () => {
    queryApi.collectRows.mockResolvedValue([
      hourlyRow({ sum_squared_error_temp: Number.MAX_SAFE_INTEGER }),
      hourlyRow({ sum_squared_error_temp: Number.MAX_SAFE_INTEGER }),
    ]);

    await expect(
      service.getKpiForDevice('device-1', 24, now),
    ).resolves.toBeNull();
  });

  it('marks revision ambiguous when rows contain different revisions', async () => {
    queryApi.collectRows.mockResolvedValue([
      hourlyRow({ config_revision: '7' }),
      hourlyRow({ config_revision: '8' }),
    ]);

    await expect(
      service.getKpiForDevice('device-1', 24, now),
    ).resolves.toMatchObject({
      configRevision: null,
      dataQualityWarning: true,
    });
  });

  it('fails closed when Influx query fails', async () => {
    queryApi.collectRows.mockRejectedValue(new Error('Influx unavailable'));

    await expect(
      service.getKpiForDevice('device-1', 24, now),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  describe('checkDeviceOnline', () => {
    it('returns true when the latest telemetry is strictly within five minutes', async () => {
      queryApi.collectRows.mockResolvedValue([
        { _time: '2026-07-25T11:56:00.000Z' },
      ]);

      await expect(service.checkDeviceOnline('device-1', now)).resolves.toBe(
        true,
      );
      const flux = latestFluxQuery(collectRows);
      expect(flux).toContain('bucket: "raw_bucket"');
      expect(flux).toContain('device_id"] == "device-1"');
      expect(flux).toContain('controller_history');
      expect(flux).toContain('limit(n: 1)');
    });

    it('returns false at the five-minute boundary', async () => {
      queryApi.collectRows.mockResolvedValue([
        { _time: '2026-07-25T11:55:00.000Z' },
      ]);

      await expect(service.checkDeviceOnline('device-1', now)).resolves.toBe(
        false,
      );
    });

    it('returns false for missing, malformed, or future telemetry', async () => {
      queryApi.collectRows.mockResolvedValue([]);
      await expect(service.checkDeviceOnline('device-1', now)).resolves.toBe(
        false,
      );

      queryApi.collectRows.mockResolvedValue([{ _time: 'not-a-date' }]);
      await expect(service.checkDeviceOnline('device-1', now)).resolves.toBe(
        false,
      );

      queryApi.collectRows.mockResolvedValue([
        { _time: '2026-07-25T12:01:00.000Z' },
      ]);
      await expect(service.checkDeviceOnline('device-1', now)).resolves.toBe(
        false,
      );
    });

    it('fails closed for query errors, missing configuration, and invalid input', async () => {
      queryApi.collectRows.mockRejectedValue(new Error('Influx unavailable'));
      await expect(service.checkDeviceOnline('device-1', now)).resolves.toBe(
        false,
      );

      influxDbService.getQueryApi.mockImplementation(() => {
        throw new Error('Influx initialization failed');
      });
      await expect(service.checkDeviceOnline('device-1', now)).resolves.toBe(
        false,
      );

      influxDbService.getQueryApi.mockReturnValue(queryApi);
      configService.get.mockReturnValue(undefined);
      await expect(service.checkDeviceOnline('device-1', now)).resolves.toBe(
        false,
      );

      configService.get.mockImplementation((key: string) =>
        key === 'INFLUXDB_BUCKET' ? 'raw_bucket' : 'analytics_bucket',
      );
      await expect(service.checkDeviceOnline('  ', now)).resolves.toBe(false);
      await expect(
        service.checkDeviceOnline('device-1', new Date('invalid')),
      ).resolves.toBe(false);
      await expect(service.checkDeviceOnline('device-1', null)).resolves.toBe(
        false,
      );
      await expect(service.checkDeviceOnline('device-1', {})).resolves.toBe(
        false,
      );
      await expect(
        service.checkDeviceOnline('device-1', {
          getTime: () => now.getTime(),
        }),
      ).resolves.toBe(false);
    });

    it('escapes device and bucket values in the liveness query', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'INFLUXDB_BUCKET' ? 'raw\\"bucket' : 'analytics_bucket',
      );
      queryApi.collectRows.mockResolvedValue([]);
      const deviceId = 'device\\"-1';

      await expect(service.checkDeviceOnline(deviceId, now)).resolves.toBe(
        false,
      );
      const flux = latestFluxQuery(collectRows);
      expect(flux).toContain('bucket: "raw\\\\\\"bucket"');
      expect(flux).toContain(`device_id"] == "${escapeFluxString(deviceId)}"`);
    });
  });
});

function defaultConfigValue(key: string): string | undefined {
  if (key === 'INFLUXDB_ANALYTICS_BUCKET') return 'analytics_bucket';
  if (key === 'INFLUXDB_BUCKET') return 'raw_bucket';
  return undefined;
}

type FluxRow = Record<string, unknown>;
type FluxCollectRowsMock = jest.Mock<Promise<FluxRow[]>, [string]>;

function latestFluxQuery(collectRows: FluxCollectRowsMock): string {
  const [call] = collectRows.mock.calls;
  const [flux] = call ?? [];
  if (typeof flux !== 'string') {
    throw new Error('Expected collectRows to be called with a Flux query');
  }
  return flux;
}

function hourlyRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sample_count: 10,
    sum_squared_error_temp: 10,
    sum_squared_error_humid: 20,
    mist_switch_count: 1,
    mist_on_duration_s: 50,
    lamp_on_duration_s: 100,
    lamp_session_count: 1,
    overshoot_temp_duration_s: 5,
    undershoot_temp_duration_s: 5,
    expected_samples: 12,
    valid_samples: 10,
    config_revision: '1',
    ...overrides,
  };
}

function kpiForGate(
  overrides: Partial<
    import('../interfaces/kpi-metrics.interface').KpiMetrics
  > = {},
) {
  return {
    deviceId: 'device-1',
    windowStart: new Date('2026-07-25T00:00:00.000Z'),
    windowEnd: new Date('2026-07-25T24:00:00.000Z'),
    tempRmse: 1,
    humidRmse: 2,
    mistSwitchCountPerHour: 1,
    mistOnDurationSec: 500,
    lampDutyCyclePercent: 40,
    lampAvgOnDurationSec: 120,
    overshootDurationSec: 0,
    undershootDurationSec: 0,
    dataCoveragePercent: 100,
    sampleCount: 720,
    configRevision: 1,
    dataQualityWarning: false,
    ...overrides,
  };
}
