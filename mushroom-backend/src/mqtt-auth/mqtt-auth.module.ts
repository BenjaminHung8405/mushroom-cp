import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../device/entities/device.entity';
import { MqttAuthController } from './mqtt-auth.controller';
import { MqttAuthService } from './mqtt-auth.service';

@Module({
  imports: [TypeOrmModule.forFeature([Device])],
  controllers: [MqttAuthController],
  providers: [MqttAuthService],
  exports: [MqttAuthService],
})
export class MqttAuthModule {}
