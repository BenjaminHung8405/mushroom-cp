import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'node:crypto';
import { SystemJwtGuard } from './system-jwt.guard';

const secret = 's'.repeat(32);

function context(authorization?: string, isPublic = false): ExecutionContext {
  const request: { headers: { authorization?: string }; user?: unknown } = {
    headers: { authorization },
  };
  return {
    getHandler: () =>
      isPublic ? function publicHandler() {} : function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

async function token(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return sign({
    roles: ['SYSTEM'],
    sub: 'mushroom-ui-bff',
    iss: 'mushroom-ui',
    aud: 'mushroom-backend',
    iat: now,
    exp: now + 300,
    ...overrides,
  });
}

function sign(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const body = encode(payload);
  const signature = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

describe('SystemJwtGuard', () => {
  const reflector = new Reflector();
  let guard: SystemJwtGuard;

  beforeEach(() => {
    process.env.SYSTEM_JWT_SECRET = secret;
    guard = new SystemJwtGuard(reflector);
  });

  afterEach(() => {
    delete process.env.SYSTEM_JWT_SECRET;
  });

  it('allows an absent Authorization header so session auth can run', async () => {
    await expect(guard.canActivate(context())).resolves.toBe(true);
  });

  it('rejects a signed token without exp', async () => {
    const signed = sign({
      roles: ['SYSTEM'],
      sub: 'mushroom-ui-bff',
      iss: 'mushroom-ui',
      aud: 'mushroom-backend',
    });

    await expect(
      guard.canActivate(context(`Bearer ${signed}`)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each([
    ['issuer', { iss: 'attacker' }],
    ['audience', { aud: 'wrong-service' }],
    ['subject', { sub: 'browser' }],
    ['role', { roles: ['OPERATOR'] }],
  ])('rejects a token with invalid %s', async (_name, claims) => {
    const signed = await token(claims);
    const result = guard.canActivate(context(`Bearer ${signed}`));
    await expect(result).rejects.toBeInstanceOf(
      _name === 'role' ? ForbiddenException : UnauthorizedException,
    );
  });

  it('accepts the valid BFF System token and attaches verified claims', async () => {
    const signed = await token();
    const requestContext = context(`Bearer ${signed}`);
    await expect(guard.canActivate(requestContext)).resolves.toBe(true);
    const request = requestContext
      .switchToHttp()
      .getRequest<{ user?: { sub?: string; roles?: string[] } }>();
    expect(request.user).toMatchObject({
      sub: 'mushroom-ui-bff',
      roles: ['SYSTEM'],
    });
  });

  it('bypasses verification only for a public handler', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValueOnce(true);
    await expect(guard.canActivate(context(undefined, true))).resolves.toBe(
      true,
    );
  });
});
