import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Contract implemented by DevicesService in Task J2. It remains deliberately
 * minimal so authorization cannot read or expose any device metadata.
 */
export interface DevicesService {
  isDeviceOwnedByUser(deviceId: string, userId: string): Promise<boolean>;
}

/** DI token owned by the device module when its service is registered. */
export const DEVICES_SERVICE = Symbol('DEVICES_SERVICE');

interface VerifiedJwtUser {
  sub?: unknown;
}

type DeviceRequest = Request & {
  params: Request['params'] & { id?: unknown };
  user?: VerifiedJwtUser;
};

/**
 * Enforces per-device ownership after JWT authentication populated
 * `request.user`. Ownership is delegated to the device service; this guard
 * never trusts a user or device identifier from the request body.
 */
@Injectable()
export class DeviceOwnershipGuard implements CanActivate {
  constructor(
    @Inject(DEVICES_SERVICE)
    private readonly devicesService: DevicesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DeviceRequest>();
    const deviceId = request.params.id;
    const userId = request.user?.sub;

    if (!this.isNonBlankString(deviceId) || !this.isNonBlankString(userId)) {
      throw new ForbiddenException('Device ownership could not be verified.');
    }

    const owned = await this.devicesService.isDeviceOwnedByUser(
      deviceId,
      userId,
    );
    if (!owned) {
      // Do not distinguish unknown devices from devices owned by another user.
      throw new ForbiddenException('Device ownership could not be verified.');
    }

    return true;
  }

  private isNonBlankString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }
}
