import { BadRequestException } from '@nestjs/common';
import { OfflineSyncController } from './offline-sync.controller';
import type { OfflineSyncService } from './offline-sync.service';

describe('OfflineSyncController', () => {
  const service = {
    getHistory: jest.fn(),
  } as unknown as OfflineSyncService;
  const controller = new OfflineSyncController(service);

  beforeEach(() => jest.clearAllMocks());

  it('rejects missing or invalid history ranges', async () => {
    await expect(controller.getHistory('device-1', 'invalid', '2026-07-19T01:00:00.000Z'))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.getHistory('device-1', '2026-07-19T01:00:00.000Z', '2026-07-19T01:00:00.000Z'))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('forwards a validated date range to the history service', async () => {
    const getHistory = service.getHistory as jest.Mock;
    getHistory.mockResolvedValue([]);

    await expect(controller.getHistory('device-1', '2026-07-19T00:00:00.000Z', '2026-07-19T01:00:00.000Z'))
      .resolves.toEqual([]);
    expect(getHistory).toHaveBeenCalledWith(
      'device-1',
      new Date('2026-07-19T00:00:00.000Z'),
      new Date('2026-07-19T01:00:00.000Z'),
    );
  });
});
