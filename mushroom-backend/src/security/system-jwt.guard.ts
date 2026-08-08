import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';

export interface SystemJwtPayload {
  sub?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  roles: string[];
  [key: string]: unknown;
}

export function getSystemJwtSecret(): Uint8Array {
  const secret = process.env.SYSTEM_JWT_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('SYSTEM_JWT_SECRET must be at least 32 bytes.');
  }
  return new TextEncoder().encode(secret);
}

export function extractBearerToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new UnauthorizedException('Bearer JWT is required.');
  return match[1];
}

@Injectable()
export class SystemJwtGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: SystemJwtPayload }>();
    // The session guard is the browser authentication layer. Validate a
    // SYSTEM JWT when supplied, but do not require it: this lets a browser
    // transition to cookie sessions while shadow-mode BFF calls continue to
    // use their existing SYSTEM identity.
    if (!request.headers.authorization) {
      return true;
    }
    const token = extractBearerToken(request.headers.authorization);

    try {
      const [encodedHeader, encodedPayload, encodedSignature] =
        token.split('.');
      if (!encodedHeader || !encodedPayload || !encodedSignature)
        throw new Error('Malformed JWT.');
      const header = JSON.parse(
        Buffer.from(encodedHeader, 'base64url').toString('utf8'),
      ) as { alg?: string; typ?: string };
      if (header.alg !== 'HS256' || header.typ !== 'JWT')
        throw new Error('Unsupported JWT.');
      const expected = createHmac('sha256', getSystemJwtSecret())
        .update(`${encodedHeader}.${encodedPayload}`)
        .digest();
      const actual = Buffer.from(encodedSignature, 'base64url');
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Error('Bad signature.');
      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as SystemJwtPayload;
      if (
        payload.iss !== 'mushroom-ui' ||
        payload.aud !== 'mushroom-backend' ||
        payload.sub !== 'mushroom-ui-bff'
      )
        throw new Error('Invalid claims.');

      if (
        typeof payload.exp !== 'number' ||
        payload.exp <= Math.floor(Date.now() / 1000)
      ) {
        throw new UnauthorizedException(
          'System JWT is expired or missing exp.',
        );
      }

      const roles = payload.roles;
      if (!Array.isArray(roles) || !roles.includes('SYSTEM')) {
        throw new ForbiddenException('SYSTEM role is required.');
      }

      request.user = payload;
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid bearer JWT.');
    }
  }
}
