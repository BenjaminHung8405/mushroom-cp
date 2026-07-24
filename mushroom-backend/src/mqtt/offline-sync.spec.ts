import {
  crc32,
  decodeOfflineSyncBurst,
  OFFLINE_BURST_HEADER_BYTES,
  OFFLINE_BURST_MAGIC,
} from './offline-sync';

function validBurst(): Buffer {
  const body = Buffer.alloc(18);
  body.writeUInt32LE(7, 0);
  body.writeUInt32LE(30, 4);
  body.writeFloatLE(29.5, 8);
  body.writeFloatLE(82.25, 12);
  body.writeUInt8(1, 16);
  body.writeUInt8(0, 17);
  const payload = Buffer.alloc(OFFLINE_BURST_HEADER_BYTES + body.length);
  payload.writeUInt32LE(OFFLINE_BURST_MAGIC, 0);
  payload.writeUInt8(1, 4);
  payload.writeUInt8(OFFLINE_BURST_HEADER_BYTES, 5);
  payload.writeUInt16LE(1, 6);
  payload.writeUInt32LE(7, 8);
  payload.writeUInt32LE(3, 12);
  payload.writeUInt32LE(30, 16);
  payload.writeUInt32LE(crc32(body), 20);
  body.copy(payload, OFFLINE_BURST_HEADER_BYTES);
  return payload;
}

describe('offline sync binary decoder', () => {
  it('decodes the packed little-endian record', () => {
    expect(decodeOfflineSyncBurst(validBurst())).toMatchObject({
      bootCount: 7,
      chunkIndex: 3,
      sessionLastDeltaS: 30,
      records: [
        {
          bootCount: 7,
          deltaTimeS: 30,
          temp: 29.5,
          humid: 82.25,
          mistState: true,
          lampState: false,
        },
      ],
    });
  });

  it('rejects a corrupt CRC', () => {
    const burst = validBurst();
    burst.writeUInt32LE(0, 20);
    expect(() => decodeOfflineSyncBurst(burst)).toThrow('invalid chunk crc');
  });
});
