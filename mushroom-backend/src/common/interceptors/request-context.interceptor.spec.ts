import { of, Observable } from 'rxjs';
import { RequestContextInterceptor } from './request-context.interceptor';
import { RequestContextService } from '../services/request-context.service';
import type { CallHandler, ExecutionContext } from '@nestjs/common';

describe('RequestContextInterceptor', () => {
  let interceptor: RequestContextInterceptor;

  beforeEach(() => {
    interceptor = new RequestContextInterceptor();
  });

  it('should run handler inside AsyncLocalStorage context with authUser details', (done) => {
    const mockRequest = {
      authUser: {
        id: 'user-uuid-123',
        role: 'ADMIN',
        phoneNumber: '+84901234567',
      },
    };

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockRequest,
      }),
    } as ExecutionContext;

    let capturedUserId: string | undefined;

    const mockHandler: CallHandler = {
      handle: () => {
        capturedUserId = RequestContextService.getUserId();
        return of({ success: true });
      },
    };

    interceptor.intercept(mockContext, mockHandler).subscribe({
      next: (val) => {
        expect(val).toEqual({ success: true });
        expect(capturedUserId).toBe('user-uuid-123');
        done();
      },
    });
  });

  it('should teardown inner subscription upon unsubscription', () => {
    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => ({}),
      }),
    } as ExecutionContext;

    let unsubscribeCalled = false;
    const mockHandler: CallHandler = {
      handle: () =>
        new Observable(() => {
          return () => {
            unsubscribeCalled = true;
          };
        }),
    };

    const sub = interceptor.intercept(mockContext, mockHandler).subscribe();
    expect(unsubscribeCalled).toBe(false);
    sub.unsubscribe();
    expect(unsubscribeCalled).toBe(true);
  });
});
