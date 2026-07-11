import { Module, forwardRef } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { DeviceModule } from '../device/device.module';

@Module({
  imports: [forwardRef(() => DeviceModule)],
  providers: [MqttService],
  exports: [MqttService],
})
export class MqttModule {}
