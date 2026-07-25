import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module';
import { ConfigService } from './services/config.service';
import { InfluxDbService } from './services/influx-db.service';
import { ControlHistoryInfluxWriter } from './services/control-history-influx-writer.service';
import { InfluxTaskProvisionerService } from './services/influx-task-provisioner.service';

@Module({
  imports: [MqttModule],
  providers: [
    ConfigService,
    InfluxDbService,
    ControlHistoryInfluxWriter,
    InfluxTaskProvisionerService,
  ],
  exports: [ConfigService, InfluxDbService],
})
export class InfluxModule {
  constructor(
    private readonly controlHistoryInfluxWriter: ControlHistoryInfluxWriter,
  ) {}
}
