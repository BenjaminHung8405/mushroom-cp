import { DataSource } from 'typeorm';
import { TuningSseTicketCleanupService } from './tuning-sse-ticket-cleanup.service';

describe('TuningSseTicketCleanupService', () => {
  let query: jest.Mock;
  let service: TuningSseTicketCleanupService;

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    service = new TuningSseTicketCleanupService({
      query,
    } as unknown as DataSource);
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('deletes expired replay records in a bounded maintenance batch', async () => {
    await service.deleteExpiredBatch();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT $1'),
      [1_000],
    );
  });

  it('schedules cleanup independently from ticket consumption', async () => {
    jest.useFakeTimers();
    service.onModuleInit();

    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(query).toHaveBeenCalledTimes(1);
  });
});
