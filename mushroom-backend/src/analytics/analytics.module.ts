import { Module } from '@nestjs/common';
import { InfluxModule } from '../influx/influx.module';
import { ControlAnalyticsService } from './services/control-analytics.service';

@Module({
  imports: [InfluxModule],
  providers: [ControlAnalyticsService],
  exports: [ControlAnalyticsService],
})
export class AnalyticsModule {}
