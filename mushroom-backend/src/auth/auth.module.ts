import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * AuthModule — Phase-1 device bootstrap auth.
 * Provides POST /auth/token used by ESP32 after WiFi connects.
 */
@Module({
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
