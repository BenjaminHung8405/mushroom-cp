import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import type { Request } from 'express';
import type { TuningPrincipal } from '../services/tuning-configuration.service';

interface JwtClaims {
  sub?: unknown;
  house_ids?: unknown;
  roles?: unknown;
  exp?: unknown;
}

export interface TuningRequest extends Request {
  tuningPrincipal?: TuningPrincipal;
}

/**
 * Verifies a bearer JWT before mapping its server-signed claims to a tuning
 * principal. Client body/header values can never choose actor or house scope.
 */
@Injectable()
export class TuningPrincipalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TuningRequest>();
    const token = this.bearerToken(request.headers.authorization);
    const claims = this.verifyHs256Jwt(token);
    if (typeof claims.sub !== 'string' || claims.sub.trim().length === 0) {
      throw new ForbiddenException('JWT subject is required.');
    }
    const houseIds = Array.isArray(claims.house_ids) && claims.house_ids.every((id) => typeof id === 'string')
      ? claims.house_ids as string[] : [];
    const roles = Array.isArray(claims.roles) ? claims.roles : [];
    request.tuningPrincipal = { subject: claims.sub, allowedHouseIds: houseIds, isAdmin: roles.includes('admin') };
    return true;
  }

  private bearerToken(header: string | string[] | undefined): string {
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) throw new ForbiddenException('Bearer JWT is required.');
    return header.slice(7);
  }

  private verifyHs256Jwt(token: string): JwtClaims {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new ForbiddenException('JWT verification is not configured.');
    const parts = token.split('.');
    if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) throw new ForbiddenException('Malformed JWT.');
    const expected = crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');
    if (expected.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))) throw new ForbiddenException('Invalid JWT signature.');
    try {
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as JwtClaims;
      if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) throw new ForbiddenException('JWT is expired.');
      return claims;
    } catch (error: unknown) {
      if (error instanceof ForbiddenException) throw error;
      throw new ForbiddenException('Malformed JWT claims.');
    }
  }
}
