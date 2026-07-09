import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MqttModule } from './mqtt/mqtt.module';
import { DeviceModule } from './device/device.module';

@Module({
  imports: [
    MqttModule,    // MQTT connection + LWT event streaming
    DeviceModule,  // /devices/* REST + SSE endpoints
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
