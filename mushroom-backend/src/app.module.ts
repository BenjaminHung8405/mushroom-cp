import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MqttModule } from './mqtt/mqtt.module';
import { DeviceModule } from './device/device.module';
import { DatabaseModule } from './database/database.module';
import { BatchModule } from './batch/batch.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    DatabaseModule,
    MqttModule, // MQTT connection + LWT event streaming
    DeviceModule, // /devices/* REST + SSE endpoints
    BatchModule,
    TelemetryModule,
    AuthModule, // POST /auth/token for ESP32 bootstrap
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
