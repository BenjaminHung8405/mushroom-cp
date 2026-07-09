import { Module } from '@nestjs/common';
import { DeviceController } from './device.controller';
import { MqttModule } from '../mqtt/mqtt.module';

/**
 * DeviceModule — Handles device management HTTP endpoints.
 *
 * Imports MqttModule to inject MqttService into DeviceController.
 */
@Module({
  imports: [MqttModule],
  controllers: [DeviceController],
})
export class DeviceModule {}
