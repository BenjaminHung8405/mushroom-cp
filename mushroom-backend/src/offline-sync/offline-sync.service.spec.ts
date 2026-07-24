import { ServiceUnavailableException } from '@nestjs/common';
import {
  OfflineSyncService,
  toOfflineHistoryPoint,
} from './offline-sync.service';
import type { OfflineSyncBurst } from '../mqtt/offline-sync';

const burst: OfflineSyncBurst = {
  bootCount: 7,
  chunkIndex: 3,
  chunkCrc32: 123,
  sessionLastDeltaS: 30,
  records: [
    {
      bootCount: 7,
      deltaTimeS: 0,
      temp: 28.5,
      humid: 85,
      mistState: true,
      lampState: false,
    },
    {
      bootCount: 7,
      deltaTimeS: 30,
      temp: 27,
      humid: 82,
      mistState: false,
      lampState: true,
    },
  ],
};

describe('OfflineSyncService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.INFLUXDB_URL;
    delete process.env.INFLUXDB_TOKEN;
    delete process.env.INFLUXDB_ORG;
    delete process.env.INFLUXDB_BUCKET;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('rejects burst persistence when InfluxDB is not configured', async () => {
    const service = new OfflineSyncService();
    await expect(
      service.writeBurst('device-1', burst, new Date()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('writes three measurements per record with deterministic sync-burst timestamps', async () => {
    const service = new OfflineSyncService() as unknown as {
      writeApi: { writePoint: jest.Mock; flush: jest.Mock };
      writeBurst: OfflineSyncService['writeBurst'];
    };
    const writePoint = jest.fn();
    service.writeApi = {
      writePoint,
      flush: jest.fn().mockResolvedValue(undefined),
    };
    const receivedAt = new Date('2026-07-19T12:00:00.000Z');

    await service.writeBurst('device-1', burst, receivedAt);

    expect(writePoint).toHaveBeenCalledTimes(6);
    expect(service.writeApi.flush).toHaveBeenCalledTimes(1);
    const points = writePoint.mock.calls.map(([point]) => point);
    expect(points.map((point: { _name: string }) => point.name)).toEqual([
      'environment_telemetry',
      'actuator_events',
      'system_status',
      'environment_telemetry',
      'actuator_events',
      'system_status',
    ]);
    expect(points[0].tags).toMatchObject({
      device_id: 'device-1',
      data_quality: 'trusted',
      boot_count: '7',
    });
    expect(points[0].time.getTime()).toBe(receivedAt.getTime() - 30_000);
    expect(points[3].time.getTime()).toBe(receivedAt.getTime());
  });

  it('propagates Influx flush failures so the caller can withhold ACK', async () => {
    const service = new OfflineSyncService() as unknown as {
      writeApi: { writePoint: jest.Mock; flush: jest.Mock };
      writeBurst: OfflineSyncService['writeBurst'];
    };
    service.writeApi = {
      writePoint: jest.fn(),
      flush: jest.fn().mockRejectedValue(new Error('Influx unavailable')),
    };
    await expect(
      service.writeBurst('device-1', burst, new Date()),
    ).rejects.toThrow('Influx unavailable');
  });

  it('maps valid Influx history rows and keeps optional measurements nullable', () => {
    expect(
      toOfflineHistoryPoint({
        _time: '2026-07-19T00:00:00.000Z',
        data_quality: 'trusted',
        boot_count: '7',
        temperature_c: 28.5,
        humidity_percent: 85,
        mist_state: true,
        lamp_state: false,
        delta_time_s: 30,
      }),
    ).toEqual({
      time: '2026-07-19T00:00:00.000Z',
      dataQuality: 'trusted',
      bootCount: 7,
      temperature: 28.5,
      humidity: 85,
      mistState: true,
      lampState: false,
      deltaTimeS: 30,
      fuzzyTempDemand: null,
      fuzzyHumidDemand: null,
    });
    expect(toOfflineHistoryPoint({ _time: 'not-a-date' })).toBeNull();
  });

  it('returns mapped history and exposes unavailable Influx queries', async () => {
    const service = new OfflineSyncService() as unknown as {
      queryApi: { collectRows: jest.Mock };
      influxBucket: string;
      getHistory: OfflineSyncService['getHistory'];
    };
    service.influxBucket = 'mushroom';
    service.queryApi = {
      collectRows: jest.fn().mockResolvedValue([
        {
          _time: '2026-07-19T00:00:00.000Z',
          data_quality: 'trusted',
          boot_count: 2,
          temperature_c: 27,
          humidity_percent: 86,
          mist_state: false,
          lamp_state: true,
          delta_time_s: 5,
        },
      ]),
    };
    await expect(
      service.getHistory(
        'device-1',
        new Date('2026-07-19T00:00:00.000Z'),
        new Date('2026-07-19T01:00:00.000Z'),
      ),
    ).resolves.toMatchObject([
      {
        dataQuality: 'trusted',
        bootCount: 2,
        temperature: 27,
        lampState: true,
      },
    ]);
    service.queryApi.collectRows.mockRejectedValueOnce(
      new Error('Influx unavailable'),
    );
    await expect(
      service.getHistory(
        'device-1',
        new Date('2026-07-19T00:00:00.000Z'),
        new Date('2026-07-19T01:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
