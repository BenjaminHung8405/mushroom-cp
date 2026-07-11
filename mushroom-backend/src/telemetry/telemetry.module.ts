import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module';
import { BatchModule } from '../batch/batch.module';
import { DeviceModule } from '../device/device.module';
import { TelemetryController } from './controllers/telemetry.controller';
import { TelemetryService } from './services/telemetry.service';

@Module({
  imports: [MqttModule, BatchModule, DeviceModule],
  controllers: [TelemetryController],
  providers: [TelemetryService],
  exports: [TelemetryService],
})
export class TelemetryModule {}
