import { InfluxTaskProvisionerService } from './influx-task-provisioner.service';
import { ConfigService } from './config.service';

describe('InfluxTaskProvisionerService', () => {
  const environment = {
    INFLUXDB_URL: 'https://influx.example.test/',
    INFLUXDB_TOKEN: 'test-token',
    INFLUXDB_ORG: 'mushroom-org',
    INFLUXDB_BUCKET: 'raw "bucket"',
    INFLUXDB_ANALYTICS_BUCKET: 'analytics \\bucket',
  };
  let fetchMock: jest.Mock;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    fetchMock = jest.fn();
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('provisions compiled Flux with configured and escaped source/destination buckets', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ orgs: [{ id: 'org-1' }] }))
      .mockResolvedValueOnce(jsonResponse({ tasks: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1' }));

    await createService().onApplicationBootstrap();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, request] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe('https://influx.example.test/api/v2/tasks');
    const body = JSON.parse(String(request.body)) as { flux: string };
    expect(body.flux).toContain('from(bucket: "raw \\"bucket\\"")');
    expect(body.flux).toContain('bucket: "analytics \\\\bucket"');
    expect(body.flux).not.toContain('__INFLUXDB_BUCKET__');
    expect(body.flux).not.toContain('__INFLUXDB_ANALYTICS_BUCKET__');
    expect(body.flux).toContain('overshoot_temp_duration_s');
    expect(body.flux).toContain('undershoot_temp_duration_s');
    expect(thresholdDurations([
      { temperature: 20.6, target: 20.0 }, // overshoot
      { temperature: 19.4, target: 20.0 }, // undershoot
      { temperature: 20.5, target: 20.0 }, // threshold is excluded
      { temperature: 19.5, target: 20.0 }, // threshold is excluded
      { temperature: 20.0, target: 20.0 }, // in range
    ])).toEqual({ overshoot: 5, undershoot: 5 });
  });

  it('does not create or modify an already active task', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ orgs: [{ id: 'org-1' }] }))
      .mockResolvedValueOnce(
        jsonResponse({ tasks: [{ id: 'task-1', name: 'kpi_hourly_aggregation', status: 'active' }] }),
      );

    await createService().onApplicationBootstrap();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-enables a disabled task without creating a duplicate', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ orgs: [{ id: 'org-1' }] }))
      .mockResolvedValueOnce(
        jsonResponse({ tasks: [{ id: 'task-1', name: 'kpi_hourly_aggregation', status: 'inactive' }] }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1' }));

    await createService().onApplicationBootstrap();

    const [url, request] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url).toBe('https://influx.example.test/api/v2/tasks/task-1');
    expect(request.method).toBe('PATCH');
    expect(JSON.parse(String(request.body))).toMatchObject({ status: 'active' });
  });

  it('fails closed before making an API call when the analytics bucket is absent', async () => {
    await expect(
      createService({ ...environment, INFLUXDB_ANALYTICS_BUCKET: '' }).onApplicationBootstrap(),
    ).rejects.toThrow('INFLUXDB_ANALYTICS_BUCKET must be a non-empty value');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  function createService(values = environment): InfluxTaskProvisionerService {
    const configService: Pick<ConfigService, 'get'> = {
      get: (key) => values[key as keyof typeof values],
    };
    return new InfluxTaskProvisionerService(configService as ConfigService);
  }
});

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => value,
  } as Response;
}

function thresholdDurations(
  samples: ReadonlyArray<{ temperature: number; target: number }>,
): { overshoot: number; undershoot: number } {
  return samples.reduce(
    (duration, sample) => ({
      overshoot:
        duration.overshoot + (sample.temperature > sample.target + 0.5 ? 5 : 0),
      undershoot:
        duration.undershoot + (sample.temperature < sample.target - 0.5 ? 5 : 0),
    }),
    { overshoot: 0, undershoot: 0 },
  );
}
