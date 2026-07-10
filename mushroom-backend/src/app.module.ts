import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MqttModule } from './mqtt/mqtt.module';
import { DeviceModule } from './device/device.module';
import { DatabaseModule } from './database/database.module';
import { BatchModule } from './batch/batch.module';
import { TelemetryModule } from './telemetry/telemetry.module';

@Module({
  imports: [
    DatabaseModule,
    MqttModule, // MQTT connection + LWT event streaming
    DeviceModule, // /devices/* REST + SSE endpoints
    BatchModule,
    TelemetryModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
