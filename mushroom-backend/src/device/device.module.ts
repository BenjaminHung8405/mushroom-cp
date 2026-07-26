import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceController } from './device.controller';
import { MqttModule } from '../mqtt/mqtt.module';
import { Device } from './entities/device.entity';
import { DeviceRegistryService } from './device-registry.service';
import { BatchModule } from '../batch/batch.module';
import { DeviceHealthModule } from '../device-health/device-health.module';
import { DEVICES_SERVICE, DevicesService } from './devices.service';

/**
 * DeviceModule — registry + HTTP endpoints for device status/control.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Device]),
    forwardRef(() => MqttModule),
    BatchModule,
    DeviceHealthModule,
  ],
  controllers: [DeviceController],
  providers: [
    DeviceRegistryService,
    DevicesService,
    { provide: DEVICES_SERVICE, useExisting: DevicesService },
  ],
  exports: [
    DeviceRegistryService,
    DevicesService,
    DEVICES_SERVICE,
    TypeOrmModule,
  ],
})
export class DeviceModule {}
