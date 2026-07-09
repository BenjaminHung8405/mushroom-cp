import { Module } from '@nestjs/common';
import { MqttService } from './mqtt.service';

/**
 * MqttModule — Provides the MqttService globally to the application.
 *
 * The MqttService is exported so that other modules (DeviceModule, etc.)
 * can inject it without re-importing this module.
 */
@Module({
  providers: [MqttService],
  exports: [MqttService],
})
export class MqttModule {}
