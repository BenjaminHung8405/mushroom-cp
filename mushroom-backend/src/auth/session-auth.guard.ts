import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../security/public.decorator';
import { AuthService } from './auth.service';
import { AUTH_ROLES_KEY } from './auth.decorators';
import type { AuthPrincipal } from './auth.types';
import { UserRole } from './entities/user.entity';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;

    const request = context
      .switchToHttp()
      .getRequest<
        Request & { authUser?: AuthPrincipal; user?: { roles?: string[] } }
      >();
    const mode =
      process.env.AUTH_ENFORCEMENT_MODE?.trim().toLowerCase() || 'shadow';
    const cookieName = process.env.AUTH_SESSION_COOKIE_NAME?.trim() || 'sid';
    const cookieToken = this.cookie(request.headers.cookie, cookieName);

    if (cookieToken) {
      try {
        const principal = await this.auth.authenticate(cookieToken);
        if (principal.mustSetPin && !this.isPinRecoveryRoute(request)) {
          throw new ForbiddenException('PIN change is required.');
        }
        request.authUser = principal;
        const roles = this.reflector.getAllAndOverride<UserRole[]>(
          AUTH_ROLES_KEY,
          [context.getHandler(), context.getClass()],
        );
        if (roles && !roles.includes(principal.role)) {
          throw new ForbiddenException('Insufficient role.');
        }
        return true;
      } catch (err) {
        if (err instanceof ForbiddenException) throw err;
        if (
          mode === 'shadow' &&
          request.user?.roles?.includes('SYSTEM') &&
          !request.path.startsWith('/admin') &&
          !request.path.startsWith('/auth')
        ) {
          return true;
        }
        throw err;
      }
    }

    if (
      mode === 'shadow' &&
      request.user?.roles?.includes('SYSTEM') &&
      !request.path.startsWith('/admin') &&
      !request.path.startsWith('/auth')
    ) {
      return true;
    }

    const principal = await this.auth.authenticate(cookieToken);
    if (principal.mustSetPin && !this.isPinRecoveryRoute(request)) {
      throw new ForbiddenException('PIN change is required.');
    }
    request.authUser = principal;
    const roles = this.reflector.getAllAndOverride<UserRole[]>(AUTH_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && !roles.includes(principal.role)) {
      throw new ForbiddenException('Insufficient role.');
    }
    return true;
  }

  private isPinRecoveryRoute(request: Request): boolean {
    return (
      request.path === '/auth/me' ||
      request.path === '/auth/set-pin' ||
      request.path === '/auth/logout'
    );
  }

  private cookie(header: string | undefined, name: string): string | undefined {
    const encoded = header
      ?.split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${name}=`))
      ?.slice(name.length + 1);
    if (!encoded) return undefined;
    try {
      return decodeURIComponent(encoded);
    } catch {
      return undefined;
    }
  }
}
