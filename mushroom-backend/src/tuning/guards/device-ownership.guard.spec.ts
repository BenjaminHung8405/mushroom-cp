import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import {
  DeviceOwnershipGuard,
  type DevicesService,
} from './device-ownership.guard';

describe('DeviceOwnershipGuard', () => {
  const devicesService: jest.Mocked<DevicesService> = {
    isDeviceOwnedByUser: jest.fn(),
  };
  const guard = new DeviceOwnershipGuard(devicesService);

  beforeEach(() => jest.clearAllMocks());

  function contextFor(request: {
    params: { id?: unknown };
    user?: { sub?: unknown };
  }): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: <T>() => request as T,
      }),
    } as unknown as ExecutionContext;
  }

  it('authorizes only when the database service verifies the JWT subject owns the route device', async () => {
    const ownershipCheck = jest.fn<Promise<boolean>, [string, string]>();
    devicesService.isDeviceOwnedByUser = ownershipCheck;
    ownershipCheck.mockResolvedValue(true);

    await expect(
      guard.canActivate(
        contextFor({ params: { id: 'device-1' }, user: { sub: 'user-1' } }),
      ),
    ).resolves.toBe(true);
    expect(ownershipCheck).toHaveBeenCalledWith('device-1', 'user-1');
  });

  it.each([
    { params: { id: 'device-1' }, user: { sub: 'user-2' } },
    { params: { id: 'device-1' } },
    { params: {}, user: { sub: 'user-1' } },
  ])(
    'fails closed without leaking whether a device exists',
    async (request) => {
      devicesService.isDeviceOwnedByUser.mockResolvedValue(false);

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        ForbiddenException,
      );
    },
  );
});
