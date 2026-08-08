import {
  SetMetadata,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from './entities/user.entity';
import type { AuthPrincipal } from './auth.types';

export const AUTH_ROLES_KEY = 'authRoles';
export const RequireRoles = (...roles: UserRole[]) =>
  SetMetadata(AUTH_ROLES_KEY, roles);
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    return ctx
      .switchToHttp()
      .getRequest<Request & { authUser: AuthPrincipal }>().authUser;
  },
);
