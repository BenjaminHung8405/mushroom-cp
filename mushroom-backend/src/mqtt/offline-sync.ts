export const OFFLINE_BURST_MAGIC = 0x4d535442;
export const OFFLINE_BURST_VERSION = 1;
export const OFFLINE_BURST_HEADER_BYTES = 24;
export const OFFLINE_TELEMETRY_BYTES = 18;
export const OFFLINE_MAX_RECORDS_PER_BURST = 96;

export interface OfflineTelemetryRecord {
  bootCount: number;
  deltaTimeS: number;
  temp: number;
  humid: number;
  mistState: boolean;
  lampState: boolean;
}

export interface OfflineSyncBurst {
  bootCount: number;
  chunkIndex: number;
  sessionLastDeltaS: number;
  chunkCrc32: number;
  records: OfflineTelemetryRecord[];
}

export function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

export function decodeOfflineSyncBurst(payload: Buffer): OfflineSyncBurst {
  if (payload.length < OFFLINE_BURST_HEADER_BYTES) throw new Error('payload too short');
  if (payload.readUInt32LE(0) !== OFFLINE_BURST_MAGIC) throw new Error('invalid magic');
  if (payload.readUInt8(4) !== OFFLINE_BURST_VERSION || payload.readUInt8(5) !== OFFLINE_BURST_HEADER_BYTES) {
    throw new Error('unsupported schema');
  }
  const recordCount = payload.readUInt16LE(6);
  if (recordCount === 0 || recordCount > OFFLINE_MAX_RECORDS_PER_BURST) throw new Error('invalid record count');
  const expectedLength = OFFLINE_BURST_HEADER_BYTES + recordCount * OFFLINE_TELEMETRY_BYTES;
  if (payload.length !== expectedLength) throw new Error('invalid payload length');

  const bootCount = payload.readUInt32LE(8);
  const chunkIndex = payload.readUInt32LE(12);
  const sessionLastDeltaS = payload.readUInt32LE(16);
  const chunkCrc32 = payload.readUInt32LE(20);
  const body = payload.subarray(OFFLINE_BURST_HEADER_BYTES);
  if (crc32(body) !== chunkCrc32) throw new Error('invalid chunk crc');

  const records: OfflineTelemetryRecord[] = [];
  let previousDelta = -1;
  for (let i = 0; i < recordCount; i += 1) {
    const offset = OFFLINE_BURST_HEADER_BYTES + i * OFFLINE_TELEMETRY_BYTES;
    const recordBootCount = payload.readUInt32LE(offset);
    const deltaTimeS = payload.readUInt32LE(offset + 4);
    const temp = payload.readFloatLE(offset + 8);
    const humid = payload.readFloatLE(offset + 12);
    const mistState = payload.readUInt8(offset + 16);
    const lampState = payload.readUInt8(offset + 17);
    if (recordBootCount !== bootCount || !Number.isFinite(temp) || !Number.isFinite(humid) ||
        (mistState !== 0 && mistState !== 1) || (lampState !== 0 && lampState !== 1) ||
        deltaTimeS < previousDelta || deltaTimeS > sessionLastDeltaS) {
      throw new Error('invalid record');
    }
    previousDelta = deltaTimeS;
    records.push({ bootCount, deltaTimeS, temp, humid, mistState: mistState === 1, lampState: lampState === 1 });
  }
  return { bootCount, chunkIndex, sessionLastDeltaS, chunkCrc32, records };
}
