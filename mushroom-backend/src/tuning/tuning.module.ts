import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceTuningConfiguration } from './entities/device-tuning-configuration.entity';
import { TuningAuditLog } from './entities/tuning-audit-log.entity';
import { TuningConfigurationService } from './services/tuning-configuration.service';
import { MqttModule } from '../mqtt/mqtt.module';
import { TuningController } from './controllers/tuning.controller';
import { TuningPrincipalGuard } from './guards/tuning-principal.guard';
import { TuningMqttOutbox } from './entities/tuning-mqtt-outbox.entity';
import { TuningMqttOutboxDispatcher } from './services/tuning-mqtt-outbox-dispatcher.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { DeviceModule } from '../device/device.module';
import { DeviceOwnershipGuard } from './guards/device-ownership.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TuningRecommendationController } from './controllers/tuning-recommendation.controller';
import { TuningCommandController } from './controllers/tuning-command.controller';

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
    DeviceModule,
  ],
  controllers: [
    TuningController,
    TuningRecommendationController,
    TuningCommandController,
  ],
  providers: [
    TuningConfigurationService,
    TuningMqttOutboxDispatcher,
    TuningPrincipalGuard,
    JwtAuthGuard,
    DeviceOwnershipGuard,
  ],
  exports: [TuningConfigurationService, TypeOrmModule],
})
export class TuningModule {}
