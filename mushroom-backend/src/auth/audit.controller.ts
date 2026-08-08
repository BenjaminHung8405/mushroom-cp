import { Controller, Get, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Repository } from 'typeorm';
import { RequireRoles } from './auth.decorators';
import { UserRole } from './entities/user.entity';
import { SystemAuditLog } from '../security/entities/system-audit-log.entity';
import { AuthSecurityEvent } from './entities/auth-security-event.entity';

class AuditQueryDto {
  @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) offset?: number;
}

/** Security/audit reads are administrative until house-bound audit records exist. */
@Controller('admin/audit-logs')
@RequireRoles(UserRole.ADMIN)
export class AuditController {
  constructor(
    @InjectRepository(SystemAuditLog)
    private readonly systemAudit: Repository<SystemAuditLog>,
    @InjectRepository(AuthSecurityEvent)
    private readonly authEvents: Repository<AuthSecurityEvent>,
  ) {}

  @Get()
  async list(@Query() query: AuditQueryDto) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const [system, systemTotal] = await this.systemAudit.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    const [auth, authTotal] = await this.authEvents.findAndCount({
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { system, auth, systemTotal, authTotal, limit, offset };
  }
}
