import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemAuditLog } from './entities/system-audit-log.entity';
import { SystemAuditLogger } from './system-audit.logger';
import { SystemJwtGuard } from './system-jwt.guard';
import { AuthModule } from '../auth/auth.module';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AuthPolicyGuard } from '../auth/auth-policy.guard';

@Module({
  imports: [
    AuthModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    TypeOrmModule.forFeature([SystemAuditLog]),
  ],
  providers: [
    { provide: APP_GUARD, useClass: SystemJwtGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: AuthPolicyGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: SystemAuditLogger },
  ],
})
export class SecurityModule {}
