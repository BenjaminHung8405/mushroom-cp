import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceTuningConfiguration } from './entities/device-tuning-configuration.entity';
import { TuningAuditLog } from './entities/tuning-audit-log.entity';
import { TuningConfigurationService } from './services/tuning-configuration.service';
import { MqttModule } from '../mqtt/mqtt.module';
import { TuningController } from './controllers/tuning.controller';
import { TuningPrincipalGuard } from './guards/tuning-principal.guard';

/**
 * TuningModule — Manages IIoT Direct-Relay Fuzzy Dynamic Tuning configurations and audit logs.
 * Tuân thủ modular Clean Architecture: controller/service/entity ở module riêng.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([DeviceTuningConfiguration, TuningAuditLog]),
    forwardRef(() => MqttModule),
  ],
  controllers: [TuningController],
  providers: [TuningConfigurationService, TuningPrincipalGuard],
  exports: [TuningConfigurationService, TypeOrmModule],
})
export class TuningModule {}
