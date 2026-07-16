import { Module, forwardRef } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { DeviceModule } from '../device/device.module';
import { MqttAuthModule } from '../mqtt-auth/mqtt-auth.module';

@Module({
  imports: [forwardRef(() => DeviceModule), MqttAuthModule],
  providers: [MqttService],
  exports: [MqttService],
})
export class MqttModule {}
