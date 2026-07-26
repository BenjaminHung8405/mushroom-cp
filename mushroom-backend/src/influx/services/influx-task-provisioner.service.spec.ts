import { InfluxTaskProvisionerService } from './influx-task-provisioner.service';
import { ConfigService } from './config.service';
import { AnalyticsAvailabilityService } from './analytics-availability.service';

describe('InfluxTaskProvisionerService', () => {
  const environment = {
    INFLUXDB_URL: 'https://influx.example.test/',
    INFLUXDB_TOKEN: 'test-token',
    INFLUXDB_ORG: 'mushroom-org',
    INFLUXDB_BUCKET: 'raw "bucket"',
    INFLUXDB_ANALYTICS_BUCKET: 'analytics \\bucket',
  };
  let fetchMock: jest.MockedFunction<typeof fetch>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    fetchMock = jest.fn<typeof fetch>();
    originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
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
    const [url, request] = fetchMock.mock.calls[2];
    expect(url).toBe('https://influx.example.test/api/v2/tasks');
    const body = parseJsonBody(request.body) as { flux: string };
    expect(body.flux).toContain('from(bucket: "raw \\"bucket\\"")');
    expect(body.flux).toContain('bucket: "analytics \\\\bucket"');
    expect(body.flux).not.toContain('__INFLUXDB_BUCKET__');
    expect(body.flux).not.toContain('__INFLUXDB_ANALYTICS_BUCKET__');
    expect(body.flux).toContain('overshoot_temp_duration_s');
    expect(body.flux).toContain('undershoot_temp_duration_s');
    expect(
      thresholdDurations([
        { temperature: 20.6, target: 20.0 }, // overshoot
        { temperature: 19.4, target: 20.0 }, // undershoot
        { temperature: 20.5, target: 20.0 }, // threshold is excluded
        { temperature: 19.5, target: 20.0 }, // threshold is excluded
        { temperature: 20.0, target: 20.0 }, // in range
      ]),
    ).toEqual({ overshoot: 5, undershoot: 5 });
  });

  it('does not create or modify an already active task', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ orgs: [{ id: 'org-1' }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          tasks: [
            { id: 'task-1', name: 'kpi_hourly_aggregation', status: 'active' },
          ],
        }),
      );

    await createService().onApplicationBootstrap();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('re-enables a disabled task without creating a duplicate', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ orgs: [{ id: 'org-1' }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          tasks: [
            {
              id: 'task-1',
              name: 'kpi_hourly_aggregation',
              status: 'inactive',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 'task-1' }));

    await createService().onApplicationBootstrap();

    const [url, request] = fetchMock.mock.calls[2];
    expect(url).toBe('https://influx.example.test/api/v2/tasks/task-1');
    expect(request.method).toBe('PATCH');
    expect(parseJsonBody(request.body)).toMatchObject({ status: 'active' });
  });

  it('fails closed when a named task lookup returns a different valid task', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ orgs: [{ id: 'org-1' }] }))
      .mockResolvedValueOnce(
        jsonResponse({
          tasks: [
            { id: 'other-task', name: 'unrelated_task', status: 'inactive' },
          ],
        }),
      );

    const availability = createAvailability();
    await createService(environment, availability).onApplicationBootstrap();
    expect(availability.getState()).toEqual({
      available: false,
      reason:
        'InfluxDB Tasks API response did not include kpi_hourly_aggregation for its named lookup',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.some(([, request]) => request.method === 'PATCH'),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(([, request]) => request.method === 'POST'),
    ).toBe(false);
  });

  it('degrades analytics without aborting Nest bootstrap when the analytics bucket is absent', async () => {
    const availability = createAvailability();
    await expect(
      createService(
        { ...environment, INFLUXDB_ANALYTICS_BUCKET: '' },
        availability,
      ).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(availability.getState()).toEqual({
      available: false,
      reason:
        'INFLUXDB_ANALYTICS_BUCKET must be a non-empty value of at most 255 characters',
    });
  });

  it.each([
    ['INFLUXDB_BUCKET', ''],
    ['INFLUXDB_ANALYTICS_BUCKET', ''],
  ])('degrades cleanly for missing %s', async (key, value) => {
    const availability = createAvailability();
    await createService(
      { ...environment, [key]: value },
      availability,
    ).onApplicationBootstrap();
    expect(availability.getState().available).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  const apiFailureCases: ReadonlyArray<readonly [Response, string]> = [
    [jsonResponse({ orgs: [] }), 'organization'],
    [{ ok: false, status: 401, json: jest.fn() } as Response, 'request failed'],
  ];
  it.each(apiFailureCases)(
    'degrades cleanly for Influx API failures',
    async (response, reason) => {
      const availability = createAvailability();
      fetchMock.mockResolvedValueOnce(response);
      await createService(environment, availability).onApplicationBootstrap();
      const state = availability.getState();
      expect(state.available).toBe(false);
      expect(state.reason).toMatch(new RegExp(reason, 'i'));
    },
  );

  const malformedTaskResponses: readonly unknown[] = [
    { tasks: [{}] },
    { tasks: null },
    { tasks: [{ name: 'kpi_hourly_aggregation', status: 'active' }] },
    {
      tasks: [
        { id: 'task-1', name: 'kpi_hourly_aggregation', status: 'unknown' },
      ],
    },
    'not-an-object',
    null,
  ];
  for (const malformedPayload of malformedTaskResponses) {
    it(`degrades on malformed Tasks API response: ${JSON.stringify(malformedPayload)}`, async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ orgs: [{ id: 'org-1' }] }))
        .mockResolvedValueOnce(jsonResponse(malformedPayload));

      const availability = createAvailability();
      await createService(environment, availability).onApplicationBootstrap();
      const state = availability.getState();
      expect(state.available).toBe(false);
      expect(state.reason).toMatch(/Malformed InfluxDB/u);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  }

  function createService(
    values = environment,
    availability = createAvailability(),
  ): InfluxTaskProvisionerService {
    const configService: Pick<ConfigService, 'get'> = {
      get: (key) => values[key as keyof typeof values],
    };
    return new InfluxTaskProvisionerService(configService, availability);
  }

  function createAvailability(): AnalyticsAvailabilityService {
    return new AnalyticsAvailabilityService();
  }
});

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(value),
  } as Response;
}

function parseJsonBody(body: BodyInit | null): Record<string, unknown> {
  if (typeof body !== 'string') {
    throw new TypeError('Expected a JSON string request body');
  }
  return JSON.parse(body) as Record<string, unknown>;
}

function thresholdDurations(
  samples: ReadonlyArray<{ temperature: number; target: number }>,
): { overshoot: number; undershoot: number } {
  return samples.reduce(
    (duration, sample) => ({
      overshoot:
        duration.overshoot + (sample.temperature > sample.target + 0.5 ? 5 : 0),
      undershoot:
        duration.undershoot +
        (sample.temperature < sample.target - 0.5 ? 5 : 0),
    }),
    { overshoot: 0, undershoot: 0 },
  );
}
