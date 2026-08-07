import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Request } from 'express';
import type { AuthPrincipal } from './auth.types';
import { UserRole } from './entities/user.entity';

/** Resource-level scope checks for device/house routes. */
@Injectable()
export class AuthPolicyGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { authUser?: AuthPrincipal }>();
    const principal = request.authUser;
    if (!principal || principal.role === UserRole.ADMIN) return true;
    if (request.method !== 'GET' && request.method !== 'HEAD' && principal.role === UserRole.AUDITOR) {
      throw new ForbiddenException('AUDITOR accounts are read-only.');
    }

    const deviceId = typeof request.params?.id === 'string' ? request.params.id : typeof request.params?.deviceId === 'string' ? request.params.deviceId : null;
    const houseId = typeof request.params?.houseId === 'string' ? request.params.houseId : null;
    const route = request.path;
    if (route.startsWith('/auth/') || route.startsWith('/admin/')) return true;
    if (deviceId) {
      const rows = await this.dataSource.query('SELECT house_id FROM devices WHERE device_id = $1', [deviceId]) as Array<{ house_id: string }>;
      if (!rows.length) throw new NotFoundException('Resource not found.');
      if (!principal.houseIds.includes(rows[0].house_id)) throw new NotFoundException('Resource not found.');
    } else if (houseId && !principal.houseIds.includes(houseId)) {
      throw new NotFoundException('Resource not found.');
    } else if (route === '/batches') {
      // Collection reads/writes are scoped in the controller/service because
      // they do not carry a resource identifier in the URL.
      if (request.method !== 'GET') throw new ForbiddenException('A scoped batch request is required.');
    }
    return true;
  }
}
