import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Phase-1 device token request body.
 * Firmware sends clientId + mqttUser after WiFi connects.
 */
export class RequestTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  clientId: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  mqttUser?: string;
}
