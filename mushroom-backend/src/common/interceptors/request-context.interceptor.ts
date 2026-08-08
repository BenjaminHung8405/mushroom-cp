import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, defer } from 'rxjs';
import { RequestContextService } from '../services/request-context.service';
import type { Request } from 'express';
import type { AuthPrincipal } from '../../auth/auth.types';

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { authUser?: AuthPrincipal }>();
    const principal = request.authUser;
    const store = {
      userId: principal?.id,
      role: principal?.role,
      phoneNumber: principal?.phoneNumber,
    };

    return defer(() => {
      return new Observable((subscriber) => {
        return RequestContextService.run(store, () => {
          const innerSub = next.handle().subscribe(subscriber);
          return () => innerSub.unsubscribe();
        });
      });
    });
  }
}
