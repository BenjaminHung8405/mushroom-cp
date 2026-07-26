import { Module } from '@nestjs/common';
import { InfluxModule } from '../influx/influx.module';
import { ControlAnalyticsService } from './services/control-analytics.service';
import { TuningRecommenderEngine } from './services/tuning-recommender-engine.service';

@Module({
  imports: [InfluxModule],
  providers: [ControlAnalyticsService, TuningRecommenderEngine],
  exports: [ControlAnalyticsService, TuningRecommenderEngine],
})
export class AnalyticsModule {}
