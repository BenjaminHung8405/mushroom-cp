import { Body, Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { AuthTokenResponse } from './auth.service';
import { RequestTokenDto } from './dto/request-token.dto';

/**
 * AuthController — device bootstrap endpoints.
 *
 * ESP32 firmware posts to POST /auth/token after WiFi connects and
 * uses the returned token as the MQTT password.
 */
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('token')
  @HttpCode(200)
  issueToken(@Body() body: RequestTokenDto): AuthTokenResponse {
    this.logger.log(
      `Token request from clientId='${body.clientId}'` +
        (body.mqttUser ? ` mqttUser='${body.mqttUser}'` : ''),
    );
    return this.authService.issueDeviceToken(body.clientId, body.mqttUser);
  }
}
