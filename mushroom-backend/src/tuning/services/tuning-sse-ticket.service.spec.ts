import { UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TuningSseTicketService } from './tuning-sse-ticket.service';

describe('TuningSseTicketService', () => {
  let query: jest.Mock;
  let service: TuningSseTicketService;

  beforeEach(() => {
    process.env.TUNING_SSE_TICKET_SECRET = 't'.repeat(32);
    query = jest.fn().mockResolvedValue([{ jti: 'ticket-jti' }]);
    service = new TuningSseTicketService({ query } as unknown as DataSource);
  });

  it('fails closed when its independent signing secret is missing, short, or reused from JWT', () => {
    const originalTicketSecret = process.env.TUNING_SSE_TICKET_SECRET;
    const originalJwtSecret = process.env.JWT_SECRET;

    try {
      delete process.env.TUNING_SSE_TICKET_SECRET;
      process.env.JWT_SECRET = 'j'.repeat(32);
      expect(
        () => new TuningSseTicketService({ query } as unknown as DataSource),
      ).toThrow('TUNING_SSE_TICKET_SECRET must be at least 32 bytes.');

      process.env.TUNING_SSE_TICKET_SECRET = 'short-secret';
      expect(
        () => new TuningSseTicketService({ query } as unknown as DataSource),
      ).toThrow('TUNING_SSE_TICKET_SECRET must be at least 32 bytes.');

      process.env.TUNING_SSE_TICKET_SECRET = process.env.JWT_SECRET;
      expect(
        () => new TuningSseTicketService({ query } as unknown as DataSource),
      ).toThrow('TUNING_SSE_TICKET_SECRET must differ from JWT_SECRET.');
    } finally {
      if (originalTicketSecret === undefined) {
        delete process.env.TUNING_SSE_TICKET_SECRET;
      } else {
        process.env.TUNING_SSE_TICKET_SECRET = originalTicketSecret;
      }
      if (originalJwtSecret === undefined) {
        delete process.env.JWT_SECRET;
      } else {
        process.env.JWT_SECRET = originalJwtSecret;
      }
    }
  });

  it('creates a self-authenticating ticket and consumes it through durable shared replay storage', async () => {
    const ticket = service.createTicket('owner-a', 'device-a');

    await expect(service.consumeTicket(ticket, 'device-a')).resolves.toEqual({
      userId: 'owner-a',
      deviceId: 'device-a',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tuning_sse_ticket_consumptions'),
      expect.arrayContaining([expect.any(String), expect.any(Number)]),
    );
    expect(query).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM tuning_sse_ticket_consumptions'),
    );
  });

  it('rejects a replay when the shared store atomically reports an already consumed jti', async () => {
    query.mockResolvedValue([]);
    const ticket = service.createTicket('owner-a', 'device-a');
    await expect(service.consumeTicket(ticket, 'device-a')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a captured ticket on another device before attempting shared-store consumption', async () => {
    const ticket = service.createTicket('owner-a', 'device-a');

    await expect(service.consumeTicket(ticket, 'device-b')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects anonymous, JWT-shaped, and tampered query values', async () => {
    await expect(service.consumeTicket(undefined, 'device-a')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(
      service.consumeTicket('header.payload.signature', 'device-a'),
    ).rejects.toThrow(UnauthorizedException);
    const ticket = service.createTicket('owner-a', 'device-a');
    await expect(
      service.consumeTicket(`${ticket}tampered`, 'device-a'),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('can mint on one service instance and consume on another replica through shared storage', async () => {
    const replicaA = new TuningSseTicketService({
      query,
    } as unknown as DataSource);
    const replicaB = new TuningSseTicketService({
      query,
    } as unknown as DataSource);
    const ticket = replicaA.createTicket('owner-a', 'device-a');

    await expect(replicaB.consumeTicket(ticket, 'device-a')).resolves.toEqual({
      userId: 'owner-a',
      deviceId: 'device-a',
    });
  });
});
