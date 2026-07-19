import { OfflineSyncService } from './offline-sync.service';

function record(boot: number, delta: number, temp: number, humid: number, mist: number, lamp: number): Buffer {
  const buffer = Buffer.alloc(18);
  buffer.writeUInt32LE(boot, 0);
  buffer.writeUInt32LE(delta, 4);
  buffer.writeFloatLE(temp, 8);
  buffer.writeFloatLE(humid, 12);
  buffer.writeUInt8(mist, 16);
  buffer.writeUInt8(lamp, 17);
  return buffer;
}

describe('OfflineSyncService', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.INFLUXDB_URL;
    delete process.env.INFLUXDB_TOKEN;
    delete process.env.INFLUXDB_ORG;
    delete process.env.INFLUXDB_BUCKET;
  });

  afterAll(() => { process.env = originalEnv; });

  it('decodes packed little-endian OfflineTelemetryStruct records', () => {
    const service = new OfflineSyncService();
    const records = service.parsePacket(Buffer.concat([
      record(3, 30, 29.5, 81.25, 1, 0),
      record(4, 5, 30.25, 80.5, 0, 1),
    ]));
    expect(records).toEqual([
      { bootCount: 3, deltaTimeS: 30, temp: 29.5, humid: 81.25, mistState: true, lampState: false },
      { bootCount: 4, deltaTimeS: 5, temp: 30.25, humid: 80.5, mistState: false, lampState: true },
    ]);
  });

  it('rejects malformed packet lengths without throwing', () => {
    const service = new OfflineSyncService();
    expect(service.parsePacket(Buffer.alloc(17))).toEqual([]);
  });

  it('classifies greatest boot_count as trusted and older sessions as degraded', async () => {
    const service = new OfflineSyncService();
    const result = await service.ingest('device-1', Buffer.concat([
      record(1, 0, 28, 80, 0, 0),
      record(2, 10, 29, 81, 1, 1),
    ]), new Date('2026-07-19T00:00:20.000Z'));
    expect(result).toMatchObject({ currentBootCount: 2, trustedRecords: 1, degradedRecords: 1 });
  });
});
