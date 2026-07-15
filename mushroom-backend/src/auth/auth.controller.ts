import { Body, Controller, HttpCode, Logger, Post, Get, Headers, BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { AuthTokenResponse } from './auth.service';
import { RequestTokenDto } from './dto/request-token.dto';

/**
 * AuthController — device bootstrap endpoints.
 *
 * ESP32 firmware posts to POST /auth/token after WiFi connects and
 * uses the returned token as the MQTT password.
 */
@Controller()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('auth/token')
  @HttpCode(200)
  issueToken(@Body() body: RequestTokenDto): AuthTokenResponse {
    this.logger.log(
      `Token request from clientId='${body.clientId}'` +
        (body.mqttUser ? ` mqttUser='${body.mqttUser}'` : ''),
    );
    return this.authService.issueDeviceToken(body.clientId, body.mqttUser);
  }

  @Get('v1/auth/device-token')
  @HttpCode(200)
  issueDeviceToken(@Headers('x-device-id') deviceId: string): AuthTokenResponse {
    if (!deviceId) {
      throw new BadRequestException('X-Device-Id header is required');
    }
    this.logger.log(`Token request from GET device-token, deviceId='${deviceId}'`);
    return this.authService.issueDeviceToken(deviceId);
  }
}
