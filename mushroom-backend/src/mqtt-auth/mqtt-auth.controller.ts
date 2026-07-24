import {
  Body,
  Controller,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { MqttAuthService } from './mqtt-auth.service';
import type { MqttAclRequest, MqttAuthRequest } from './mqtt-auth.service';

@Controller('api/mqtt')
export class MqttAuthController {
  constructor(private readonly mqttAuthService: MqttAuthService) {}

  @Post('auth')
  @HttpCode(200)
  async authenticate(@Body() body: MqttAuthRequest): Promise<void> {
    if (!(await this.mqttAuthService.authenticate(body))) {
      throw new UnauthorizedException();
    }
  }

  @Post('superuser')
  @HttpCode(200)
  superuser(@Body() body: Pick<MqttAuthRequest, 'username'>): void {
    if (!this.mqttAuthService.isSuperuser(body.username)) {
      throw new UnauthorizedException();
    }
  }

  @Post('acl')
  @HttpCode(200)
  acl(@Body() body: MqttAclRequest): void {
    if (!this.mqttAuthService.authorize(body)) {
      throw new UnauthorizedException();
    }
  }
}
