import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module';
import { BatchModule } from '../batch/batch.module';
import { TelemetryController } from './controllers/telemetry.controller';
import { TelemetryService } from './services/telemetry.service';

@Module({
  imports: [MqttModule, BatchModule],
  controllers: [TelemetryController],
  providers: [TelemetryService],
  exports: [TelemetryService],
})
export class TelemetryModule {}
