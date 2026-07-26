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
import { DeviceOwnershipGuard } from './guards/device-ownership.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TuningRecommendationController } from './controllers/tuning-recommendation.controller';
import { TuningCommandController } from './controllers/tuning-command.controller';
import { TuningSseTicketService } from './services/tuning-sse-ticket.service';
import { TuningSseTicketCleanupService } from './services/tuning-sse-ticket-cleanup.service';
import { TuningSseTicketGuard } from './guards/tuning-sse-ticket.guard';

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
    ]),
    forwardRef(() => MqttModule),
    AnalyticsModule,
    InfluxModule,
    DeviceModule,
  ],
  controllers: [TuningRecommendationController, TuningCommandController],
  providers: [
    TuningConfigurationService,
    TuningMqttOutboxDispatcher,
    JwtAuthGuard,
    DeviceOwnershipGuard,
    TuningSseTicketService,
    TuningSseTicketCleanupService,
    TuningSseTicketGuard,
  ],
  exports: [TuningConfigurationService, TypeOrmModule],
})
export class TuningModule {}
