import { ServiceUnavailableException } from '@nestjs/common';
import { ControlAnalyticsService, escapeFluxString } from './control-analytics.service';

describe('ControlAnalyticsService', () => {
  const queryApi = { collectRows: jest.fn() };
  const influxDbService = { getQueryApi: jest.fn(() => queryApi) };
  const configService = {
    get: jest.fn((key: string) =>
      key === 'INFLUXDB_ANALYTICS_BUCKET' ? 'analytics_bucket' : undefined,
    ),
  };
  const service = new ControlAnalyticsService(
    influxDbService as never,
    configService as never,
  );
  const now = new Date('2026-07-25T12:00:00.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('aggregates rolling KPI using total squared error and total samples', async () => {
    queryApi.collectRows.mockResolvedValue([
      hourlyRow({
        sample_count: 100,
        sum_squared_error_temp: 100,
        sum_squared_error_humid: 400,
        mist_switch_count: 10,
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
      lampDutyCyclePercent: (5_400 / 7_200) * 100,
      lampAvgOnDurationSec: 1_080,
      overshootDurationSec: 10,
      undershootDurationSec: 10,
      dataCoveragePercent: (400 / 480) * 100,
      sampleCount: 400,
      configRevision: 7,
      dataQualityWarning: false,
    });

    const flux = queryApi.collectRows.mock.calls[0][0] as string;
    expect(flux).toContain('bucket: "analytics_bucket"');
    expect(flux).toContain('device_id"] == "device-1"');
    expect(flux).not.toContain('aggregateWindow');
  });

  it('escapes a device id before putting it in Flux', async () => {
    queryApi.collectRows.mockResolvedValue([]);
    const deviceId = 'device\\"-1';

    await expect(service.getKpiForDevice(deviceId, 24, now)).resolves.toBeNull();

    const flux = queryApi.collectRows.mock.calls[0][0] as string;
    expect(flux).toContain(`device_id"] == "${escapeFluxString(deviceId)}"`);
    expect(flux).not.toContain(deviceId);
  });

  it('returns null when all rows are absent or invalid', async () => {
    queryApi.collectRows.mockResolvedValue([
      { sample_count: 0, expected_samples: 0 },
    ]);

    await expect(service.getKpiForDevice('device-1', 24, now)).resolves.toBeNull();
  });

  it('marks revision ambiguous when rows contain different revisions', async () => {
    queryApi.collectRows.mockResolvedValue([
      hourlyRow({ config_revision: '7' }),
      hourlyRow({ config_revision: '8' }),
    ]);

    await expect(service.getKpiForDevice('device-1', 24, now)).resolves.toMatchObject({
      configRevision: null,
      dataQualityWarning: true,
    });
  });

  it('fails closed when Influx query fails', async () => {
    queryApi.collectRows.mockRejectedValue(new Error('Influx unavailable'));

    await expect(service.getKpiForDevice('device-1', 24, now)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

function hourlyRow(overrides: Record<string, unknown> = {}) {
  return {
    sample_count: 10,
    sum_squared_error_temp: 10,
    sum_squared_error_humid: 20,
    mist_switch_count: 1,
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
