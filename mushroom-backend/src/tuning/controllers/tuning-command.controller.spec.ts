import { TuningCommandController } from './tuning-command.controller';
import { TuningConfigurationService } from '../services/tuning-configuration.service';
import { CreateTuningConfigurationDto } from '../dtos/create-tuning-configuration.dto';
import { BadRequestException } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { Subject } from 'rxjs';
import type { TuningSyncEvent } from '../services/tuning-configuration.service';
import { MAX_TUNING_HISTORY_OFFSET } from '../services/tuning-configuration.service';
import { TuningSseTicketService } from '../services/tuning-sse-ticket.service';
import { DataSource } from 'typeorm';

describe('TuningCommandController', () => {
  const createPendingCommandNonUser = jest.fn();
  const getLatestByDeviceId = jest.fn();
  const getTuningHistory = jest.fn();
  const tuningSync$ = new Subject<TuningSyncEvent>();
  const service = {
    createPendingCommandNonUser,
    getLatestByDeviceId,
    getTuningHistory,
    tuningSync$,
  } as unknown as TuningConfigurationService;
  let ticketService: TuningSseTicketService;
  let controller: TuningCommandController;

  const commandId = '12345678-1234-1234-1234-1234567890ab';
  const config = {
    lamp_gain_scale: 1,
    mist_gain_scale: 1,
    mist_on_threshold: 0.25,
    mist_off_threshold: 0.15,
  };
  const dto: CreateTuningConfigurationDto = { commandId, config };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TUNING_SSE_TICKET_SECRET = 't'.repeat(32);
    ticketService = new TuningSseTicketService({
      query: jest.fn(),
    } as unknown as DataSource);
    controller = new TuningCommandController(service, ticketService);
    createPendingCommandNonUser.mockResolvedValue({
      commandId,
      status: 'PENDING',
    });
    getLatestByDeviceId.mockResolvedValue(null);
    getTuningHistory.mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });

  it('delegates durable command creation in non-user mode', async () => {
    const result = await controller.createTuningConfiguration('device-1', dto);

    expect(createPendingCommandNonUser).toHaveBeenCalledWith(
      'device-1',
      config,
      commandId,
    );
    expect(result).toEqual({ commandId, status: 'PENDING' });
  });

  it('returns the latest durable configuration state', async () => {
    const latestConfiguration = {
      commandId,
      deviceId: 'device-1',
      revision: 2,
      status: 'IN_SYNC',
      config,
    };
    getLatestByDeviceId.mockResolvedValue(latestConfiguration);

    await expect(
      controller.getLatestTuningConfiguration('device-1'),
    ).resolves.toBe(latestConfiguration);
    expect(getLatestByDeviceId).toHaveBeenCalledTimes(1);
    expect(getLatestByDeviceId).toHaveBeenCalledWith('device-1');
  });

  it('preserves a missing durable configuration as null', async () => {
    await expect(
      controller.getLatestTuningConfiguration('device-without-configuration'),
    ).resolves.toBeNull();
    expect(getLatestByDeviceId).toHaveBeenCalledWith(
      'device-without-configuration',
    );
  });

  it('uses a bounded default pagination window for durable history', async () => {
    await expect(
      controller.getTuningHistory('device-1', undefined, undefined),
    ).resolves.toEqual({ items: [], total: 0, limit: 20, offset: 0 });

    expect(getTuningHistory).toHaveBeenCalledWith('device-1', 20, 0);
  });

  it('clamps valid history pagination before querying the repository', async () => {
    await controller.getTuningHistory('device-1', '999', '25');

    expect(getTuningHistory).toHaveBeenCalledWith('device-1', 100, 25);
  });

  it('rejects a deep offset before invoking the history service', async () => {
    await expect(
      controller.getTuningHistory(
        'device-1',
        '20',
        String(MAX_TUNING_HISTORY_OFFSET + 1),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(getTuningHistory).not.toHaveBeenCalled();
  });

  it.each([
    ['limit', '1.5', '0'],
    ['limit', '-1', '0'],
    ['limit', ['20'], '0'],
    ['offset', '20', '-1'],
    ['offset', '20', '9007199254740992'],
  ])(
    'rejects malformed %s pagination before a history query',
    async (_field, limit, offset) => {
      await expect(
        controller.getTuningHistory('device-1', limit, offset),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(getTuningHistory).not.toHaveBeenCalled();
    },
  );
  it('mints a signed, short-lived ticket for the non-user stream', () => {
    const result = controller.createTuningStreamTicket('device-1');

    expect(result).toMatchObject({ expiresInSeconds: 30 });
    expect(result.ticket).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u);
  });

  it('streams tuning configuration sync events filtered by deviceId', (done) => {
    const request = new EventEmitter() as never;
    const result$ = controller.streamTuningConfigurations('device-1', request);
    const emitted: TuningSyncEvent[] = [];
    result$.subscribe({
      next: (event) => emitted.push(event.data as TuningSyncEvent),
      complete: () => {
        expect(emitted).toHaveLength(2);
        expect(emitted[0].commandId).toBe('event-for-1');
        expect(emitted[1].commandId).toBe('another-event-for-1');
        done();
      },
    });

    tuningSync$.next(syncEvent('device-2', 'ignored'));
    tuningSync$.next(syncEvent('device-1', 'event-for-1'));
    tuningSync$.next(syncEvent('device-3', 'ignored-too'));
    tuningSync$.next(syncEvent('device-1', 'another-event-for-1'));
    (request as unknown as EventEmitter).emit('close');
  });
});

function syncEvent(deviceId: string, commandId: string): TuningSyncEvent {
  return {
    id: `event-${commandId}`,
    deviceId,
    commandId,
    revision: 1,
    status: 'PENDING',
    config: {
      lamp_gain_scale: 1,
      mist_gain_scale: 1,
      mist_on_threshold: 0.25,
      mist_off_threshold: 0.15,
    },
    publishedAt: null,
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
  };
}
