import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { User } from './entities/user.entity';
import { UserHouseAccess } from './entities/user-house-access.entity';
import { AuthSession } from './entities/auth-session.entity';
import { AuthSecurityEvent } from './entities/auth-security-event.entity';
import { SessionAuthGuard } from './session-auth.guard';
import { AdminController } from './admin.controller';
import { AuthPolicyGuard } from './auth-policy.guard';
import { AuditController } from './audit.controller';
import { SystemAuditLog } from '../security/entities/system-audit-log.entity';

import { UserPinDevice } from './entities/user-pin-device.entity';

/**
 * AuthModule — Phase-1 device bootstrap auth & Kiosk PIN authentication.
 * Provides POST /auth/token used by ESP32 after WiFi connects.
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserHouseAccess,
      AuthSession,
      AuthSecurityEvent,
      SystemAuditLog,
      UserPinDevice,
    ]),
  ],
  controllers: [AuthController, AdminController, AuditController],
  providers: [AuthService, SessionAuthGuard, AuthPolicyGuard],
  exports: [AuthService, SessionAuthGuard, AuthPolicyGuard],
})
export class AuthModule {}

