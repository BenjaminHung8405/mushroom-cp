import { Module } from '@nestjs/common';
import { DeviceHealthService } from './device-health.service';

@Module({
  providers: [DeviceHealthService],
  exports: [DeviceHealthService],
})
export class DeviceHealthModule {}
