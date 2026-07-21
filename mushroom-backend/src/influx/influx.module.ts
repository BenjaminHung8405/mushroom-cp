import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module';
import { ConfigService } from './services/config.service';
import { InfluxDbService } from './services/influx-db.service';
import { ControlHistoryInfluxWriter } from './services/control-history-influx-writer.service';

@Module({
  imports: [MqttModule],
  providers: [
    ConfigService,
    InfluxDbService,
    ControlHistoryInfluxWriter,
  ],
  exports: [
    ConfigService,
    InfluxDbService,
    ControlHistoryInfluxWriter,
  ],
})
export class InfluxModule {}
