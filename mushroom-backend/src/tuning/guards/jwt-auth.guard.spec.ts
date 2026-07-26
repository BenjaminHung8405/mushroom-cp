import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import * as crypto from 'crypto';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard();
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  it('verifies a signed JWT and exposes only verified user claims', () => {
    const request = {
      headers: {
        authorization: `Bearer ${signedToken({ sub: 'user-1', email: 'operator@example.com', house_ids: ['house-1'] })}`,
      },
    };

    expect(guard.canActivate(contextFor(request))).toBe(true);
    expect(request).toMatchObject({
      user: {
        sub: 'user-1',
        email: 'operator@example.com',
        allowedHouseIds: ['house-1'],
      },
    });
  });

  it.each([
    undefined,
    'Bearer malformed.token.value',
    `Bearer ${signedToken({ sub: 'user-1' }, 'different-secret')}`,
    `Bearer ${signedToken({ sub: 'user-1', exp: 1 })}`,
    `Bearer ${signedToken({ sub: '' })}`,
  ])(
    'rejects an absent, malformed, invalid, expired, or subjectless JWT',
    (authorization) => {
      const request = { headers: { authorization } };
      expect(() => guard.canActivate(contextFor(request))).toThrow(
        UnauthorizedException,
      );
    },
  );
});

function contextFor(request: {
  headers: { authorization?: string };
}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: <T>() => request as T,
    }),
  } as unknown as ExecutionContext;
}

function signedToken(
  claims: Record<string, unknown>,
  secret = 'test-secret',
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      ...claims,
      exp: claims.exp ?? Math.floor(Date.now() / 1_000) + 60,
    }),
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}
