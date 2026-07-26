import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import type { Request } from 'express';

interface JwtClaims {
  sub?: unknown;
  email?: unknown;
  exp?: unknown;
}

export interface VerifiedJwtUser {
  sub: string;
  email?: string;
}

export type JwtAuthenticatedRequest = Request & {
  user?: VerifiedJwtUser;
};

/**
 * Verifies an operator JWT and exposes only its verified identity to guards
 * and controllers. Client-controlled request fields are never used as actor
 * identity or authorization scope.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<JwtAuthenticatedRequest>();
    const claims = this.verifyHs256Jwt(
      this.bearerToken(request.headers.authorization),
    );

    if (typeof claims.sub !== 'string' || !claims.sub.trim()) {
      throw new UnauthorizedException('JWT subject is required.');
    }

    request.user = {
      sub: claims.sub,
      ...(typeof claims.email === 'string' && claims.email.trim()
        ? { email: claims.email }
        : {}),
    };
    return true;
  }

  private bearerToken(header: string | string[] | undefined): string {
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer JWT is required.');
    }
    return header.slice(7);
  }

  private verifyHs256Jwt(token: string): JwtClaims {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new UnauthorizedException('JWT verification is not configured.');
    }

    const parts = token.split('.');
    if (
      parts.length !== 3 ||
      !parts.every((part) => /^[A-Za-z0-9_-]+$/u.test(part))
    ) {
      throw new UnauthorizedException('Malformed JWT.');
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64url');
    if (
      expected.length !== parts[2].length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts[2]))
    ) {
      throw new UnauthorizedException('Invalid JWT signature.');
    }

    try {
      const claims: unknown = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      );
      if (!isJwtClaims(claims)) {
        throw new UnauthorizedException('Malformed JWT claims.');
      }
      if (typeof claims.exp !== 'number' || claims.exp <= Date.now() / 1_000) {
        throw new UnauthorizedException('JWT is expired.');
      }
      return claims;
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Malformed JWT claims.');
    }
  }
}

function isJwtClaims(value: unknown): value is JwtClaims {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
