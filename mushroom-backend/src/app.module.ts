import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MqttModule } from './mqtt/mqtt.module';
import { DeviceModule } from './device/device.module';
import { DatabaseModule } from './database/database.module';
import { BatchModule } from './batch/batch.module';
import { TelemetryModule } from './telemetry/telemetry.module';
import { AuthModule } from './auth/auth.module';
import { MqttAuthModule } from './mqtt-auth/mqtt-auth.module';
import { OfflineSyncModule } from './offline-sync/offline-sync.module';
import { InfluxModule } from './influx/influx.module';
import { AppConfigModule } from './config/config.module';
import { TuningModule } from './tuning/tuning.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    MqttModule, // MQTT connection + LWT event streaming
    DeviceModule, // /devices/* REST + SSE endpoints
    BatchModule,
    TelemetryModule,
    AuthModule, // POST /auth/token for ESP32 bootstrap
    MqttAuthModule,
    OfflineSyncModule,
    InfluxModule,
    TuningModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
