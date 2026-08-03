import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceTuningConfiguration } from './entities/device-tuning-configuration.entity';
import { TuningAuditLog } from './entities/tuning-audit-log.entity';
import { TuningConfigurationService } from './services/tuning-configuration.service';
import { MqttModule } from '../mqtt/mqtt.module';
import { TuningMqttOutbox } from './entities/tuning-mqtt-outbox.entity';
import { TuningMqttOutboxDispatcher } from './services/tuning-mqtt-outbox-dispatcher.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { InfluxModule } from '../influx/influx.module';
import { DeviceModule } from '../device/device.module';
import { TuningRecommendationController } from './controllers/tuning-recommendation.controller';
import { TuningCommandController } from './controllers/tuning-command.controller';
import { TuningSseTicketService } from './services/tuning-sse-ticket.service';
import { TuningSseTicketCleanupService } from './services/tuning-sse-ticket-cleanup.service';
import { TuningSseTicketGuard } from './guards/tuning-sse-ticket.guard';
import { TuningRecommendation } from './entities/tuning-recommendation.entity';
import { TuningRecommendationService } from './services/tuning-recommendation.service';
import { TuningObservationClockService } from './services/tuning-observation-clock.service';
import { TuningAdvisoryCronService } from './services/tuning-advisory-cron.service';
import { Device } from '../device/entities/device.entity';
import { TuningDiagnosticRecommendationController } from './controllers/tuning-diagnostic-recommendation.controller';

/**
 * TuningModule — Manages IIoT Direct-Relay Fuzzy Dynamic Tuning configurations and audit logs.
 * Tuân thủ modular Clean Architecture: controller/service/entity ở module riêng.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeviceTuningConfiguration,
      TuningAuditLog,
      TuningMqttOutbox,
      TuningRecommendation,
    ]),
    forwardRef(() => MqttModule),
    AnalyticsModule,
    InfluxModule,
    DeviceModule,
  ],
  controllers: [TuningRecommendationController, TuningDiagnosticRecommendationController, TuningCommandController],
  providers: [
    {
      provide: TuningConfigurationService,
      useClass: TuningConfigurationService,
    },
    TuningMqttOutboxDispatcher,
    TuningSseTicketService,
    TuningSseTicketCleanupService,
    TuningSseTicketGuard,
    TuningRecommendationService,
    TuningObservationClockService,
    TuningAdvisoryCronService,
  ],
  exports: [TuningConfigurationService, TuningRecommendationService, TypeOrmModule],
})
export class TuningModule {}
