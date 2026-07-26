import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { TuningSseTicketGuard } from './tuning-sse-ticket.guard';
import { TuningSseTicketService } from '../services/tuning-sse-ticket.service';

describe('TuningSseTicketGuard', () => {
  const consumeTicket = jest.fn();
  const tickets = { consumeTicket } as unknown as TuningSseTicketService;
  const isDeviceOwnedByUser = jest.fn();
  const guard = new TuningSseTicketGuard(tickets, { isDeviceOwnedByUser });

  beforeEach(() => {
    jest.clearAllMocks();
    consumeTicket.mockResolvedValue({
      userId: 'owner-a',
      deviceId: 'device-a',
    });
    isDeviceOwnedByUser.mockResolvedValue(true);
  });

  it('allows native EventSource only after consuming a device-bound ticket and rechecking current ownership', async () => {
    await expect(
      guard.canActivate(
        contextFor({ params: { id: 'device-a' }, query: { ticket: 'ticket' } }),
      ),
    ).resolves.toBe(true);
    expect(isDeviceOwnedByUser).toHaveBeenCalledWith('device-a', 'owner-a');
  });

  it('rejects anonymous EventSource without calling ownership lookup', async () => {
    consumeTicket.mockRejectedValue(new UnauthorizedException());
    await expect(
      guard.canActivate(contextFor({ params: { id: 'device-a' }, query: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(isDeviceOwnedByUser).not.toHaveBeenCalled();
  });

  it('rejects a cross-device ticket without leaking device data', async () => {
    consumeTicket.mockRejectedValue(new UnauthorizedException());
    await expect(
      guard.canActivate(
        contextFor({ params: { id: 'device-b' }, query: { ticket: 'ticket' } }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(isDeviceOwnedByUser).not.toHaveBeenCalled();
  });

  it('rejects a stream if ownership changed after ticket minting without leaking device existence', async () => {
    isDeviceOwnedByUser.mockResolvedValue(false);
    await expect(
      guard.canActivate(
        contextFor({ params: { id: 'device-a' }, query: { ticket: 'ticket' } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

function contextFor(request: {
  params: { id?: string };
  query: { ticket?: string };
}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: <T>() => request as T }),
  } as unknown as ExecutionContext;
}
