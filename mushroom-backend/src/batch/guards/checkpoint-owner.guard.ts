import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SystemJwtPayload } from '../../security/system-jwt.guard';

@Injectable()
export class CheckpointOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: SystemJwtPayload }>();
    const user = request.user;
    if (
      user?.sub !== 'mushroom-ui-bff' ||
      user.iss !== 'mushroom-ui' ||
      user.aud !== 'mushroom-backend' ||
      !user.roles.includes('SYSTEM')
    ) {
      throw new ForbiddenException('Verified SYSTEM identity is required.');
    }
    return true;
  }
}
