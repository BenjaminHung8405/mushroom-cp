import { of, throwError } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { SystemAuditLogger } from './system-audit.logger';

describe('SystemAuditLogger', () => {
  const response = { statusCode: 201 };
  const request = {
    method: 'POST',
    url: '/devices/device-1/tuning-configurations/stream-ticket',
    originalUrl: '/devices/device-1/tuning-configurations/stream-ticket',
    body: {},
    user: { sub: 'mushroom-ui-bff' },
    header: jest.fn(() => undefined),
  };

  function context(): ExecutionContext {
    return {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
  }

  it('preserves a successful response when audit persistence fails', (done) => {
    const repository = {
      insert: jest.fn(() => Promise.reject(new Error('audit table unavailable'))),
    };
    const logger = new SystemAuditLogger(repository as never);
    const next: CallHandler = { handle: () => of({ ticket: 'ticket-1' }) };

    logger.intercept(context(), next).subscribe({
      next: (value) => expect(value).toEqual({ ticket: 'ticket-1' }),
      error: done,
      complete: () => {
        expect(repository.insert).toHaveBeenCalledWith(
          expect.objectContaining({
            requestId: null,
            statusCode: 201,
            durationMs: expect.any(Number),
          }),
        );
        done();
      },
    });
  });

  it('preserves the original handler error when audit persistence also fails', (done) => {
    const repository = {
      insert: jest.fn(() => Promise.reject(new Error('audit table unavailable'))),
    };
    const logger = new SystemAuditLogger(repository as never);
    const handlerError = new Error('business failure');
    const next: CallHandler = { handle: () => throwError(() => handlerError) };

    logger.intercept(context(), next).subscribe({
      next: () => done(new Error('Unexpected success')),
      error: (error) => {
        expect(error).toBe(handlerError);
        done();
      },
    });
  });
});
