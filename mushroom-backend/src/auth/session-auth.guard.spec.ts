import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionAuthGuard } from './session-auth.guard';
import { AuthService } from './auth.service';
import { AuthPrincipal } from './auth.types';
import { UserRole } from './entities/user.entity';

describe('SessionAuthGuard', () => {
  let guard: SessionAuthGuard;
  let reflector: Reflector;
  let authService: AuthService;

  const mockPrincipal: AuthPrincipal = {
    id: 'user-1',
    phoneNumber: '+84901234567',
    role: UserRole.OPERATOR,
    houseIds: ['house-1'],
    sessionId: 'session-1',
    mustSetPin: false,
  };

  beforeEach(() => {
    reflector = new Reflector();
    authService = {
      authenticate: jest.fn() as any,
    } as unknown as AuthService;
    guard = new SessionAuthGuard(reflector, authService);

    delete process.env.AUTH_ENFORCEMENT_MODE;
    delete process.env.AUTH_SESSION_COOKIE_NAME;
  });

  function createMockContext(
    request: any,
    handlerFn: any = () => {},
    classFn: any = {},
  ) {
    return {
      getHandler: () => handlerFn,
      getClass: () => classFn,
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  it('allows public routes unconditionally', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const req = { path: '/public' };
    const ctx = createMockContext(req);

    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(authService.authenticate).not.toHaveBeenCalled();
  });

  it('authenticates session cookie on /auth/me even when SYSTEM role is present in shadow mode', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    jest.spyOn(authService, 'authenticate').mockResolvedValue(mockPrincipal);

    const req: any = {
      path: '/auth/me',
      headers: { cookie: 'sid=valid-token' },
      user: { roles: ['SYSTEM'] },
    };
    const ctx = createMockContext(req);

    process.env.AUTH_ENFORCEMENT_MODE = 'shadow';
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(authService.authenticate).toHaveBeenCalledWith('valid-token');
    expect(req.authUser).toEqual(mockPrincipal);
  });

  it('throws UnauthorizedException when calling /auth/me without a cookie in shadow mode', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    jest
      .spyOn(authService, 'authenticate')
      .mockRejectedValue(new UnauthorizedException('Session is required.'));

    const req: any = {
      path: '/auth/me',
      headers: {},
      user: { roles: ['SYSTEM'] },
    };
    const ctx = createMockContext(req);

    process.env.AUTH_ENFORCEMENT_MODE = 'shadow';

    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
    expect(authService.authenticate).toHaveBeenCalledWith(undefined);
  });

  it('allows SYSTEM caller without cookie on non-admin/non-auth routes in shadow mode', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const req: any = {
      path: '/devices',
      headers: {},
      user: { roles: ['SYSTEM'] },
    };
    const ctx = createMockContext(req);

    process.env.AUTH_ENFORCEMENT_MODE = 'shadow';
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(authService.authenticate).not.toHaveBeenCalled();
  });

  it('blocks caller with insufficient role', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key) => {
      if (key === 'authRoles') return [UserRole.ADMIN];
      return undefined;
    });
    jest.spyOn(authService, 'authenticate').mockResolvedValue(mockPrincipal);

    const req: any = {
      path: '/admin/users',
      headers: { cookie: 'sid=valid-token' },
    };
    const ctx = createMockContext(req);

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
