import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device } from './entities/device.entity';

/**
 * Narrow authorization-facing contract for device ownership checks.
 * It intentionally exposes no device metadata, preventing callers from
 * using authorization checks to enumerate devices.
 */
export interface DevicesServiceContract {
  isDeviceOwnedByUser(deviceId: string, userId: string): Promise<boolean>;
}

/** Injection token consumed by authorization guards outside DeviceModule. */
export const DEVICES_SERVICE = Symbol('DEVICES_SERVICE');

@Injectable()
export class DevicesService implements DevicesServiceContract {
  constructor(
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>,
  ) {}

  /**
   * Performs an existence-only, parameterized ownership lookup. A false
   * result deliberately represents both a missing device and a non-owner.
   */
  async isDeviceOwnedByUser(
    deviceId: string,
    userId: string,
  ): Promise<boolean> {
    const result: unknown = await this.deviceRepository.query(
      'SELECT 1 FROM devices WHERE device_id = $1 AND owner_user_id = $2',
      [deviceId, userId],
    );

    return Array.isArray(result) && result.length > 0;
  }
}
