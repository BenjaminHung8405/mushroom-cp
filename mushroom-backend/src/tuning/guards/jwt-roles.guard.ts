import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type DiagnosticRole = 'ADMIN' | 'TECHNICIAN' | 'OPERATOR';

@Injectable()
export class JwtRolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined>; user?: unknown }>();
    const token = request.headers.authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Bearer JWT is required.');
    const payload = verifyJwt(token);
    const roles = Array.isArray(payload.roles) ? payload.roles : [payload.role];
    if (!roles.some((role) => role === 'ADMIN' || role === 'TECHNICIAN')) throw new ForbiddenException('Diagnostic access requires ADMIN or TECHNICIAN role.');
    request.user = payload;
    return true;
  }
}

function verifyJwt(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3 || !process.env.JWT_SECRET) throw new UnauthorizedException('Invalid bearer JWT.');
  const [encodedHeader, encodedPayload, signature] = parts;
  try {
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as { alg?: string; typ?: string };
    if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new Error('Unsupported JWT.');
    const expected = createHmac('sha256', process.env.JWT_SECRET).update(`${encodedHeader}.${encodedPayload}`).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Bad signature.');
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (typeof payload.exp === 'number' && payload.exp <= Math.floor(Date.now() / 1000)) throw new Error('Expired JWT.');
    return payload;
  } catch { throw new UnauthorizedException('Invalid bearer JWT.'); }
}
