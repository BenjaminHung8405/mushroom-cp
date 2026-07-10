import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

export interface AuthTokenResponse {
  token: string;
}

/**
 * AuthService — Phase-1 bootstrap auth for ESP32 devices.
 *
 * Firmware uses the returned token as the MQTT password.
 * For the current single-farm bootstrap path we return the static
 * EMQX device password from env (MQTT_ESP32_PASS).
 *
 * Phase 2 should replace this with per-device provisioned credentials.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  issueDeviceToken(clientId: string, mqttUser?: string): AuthTokenResponse {
    const token = process.env.MQTT_ESP32_PASS;

    if (!token) {
      this.logger.error(
        'MQTT_ESP32_PASS is not set. Cannot issue device MQTT token.',
      );
      throw new ServiceUnavailableException(
        'Device auth is not configured (MQTT_ESP32_PASS missing).',
      );
    }

    this.logger.log(
      `Issuing MQTT token for clientId='${clientId}'` +
        (mqttUser ? ` mqttUser='${mqttUser}'` : ''),
    );

    return { token };
  }
}
