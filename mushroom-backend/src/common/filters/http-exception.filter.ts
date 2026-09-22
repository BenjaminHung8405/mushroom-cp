import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

export enum AuthErrorCode {
  PIN_CHANGE_REQUIRED = 'PIN_CHANGE_REQUIRED',
  SESSION_REQUIRED = 'SESSION_REQUIRED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  RATE_LIMITED = 'RATE_LIMITED',
}

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    const status = exception.getStatus();
    const raw = exception.getResponse();
    const message = typeof raw === 'string' ? raw : (raw as { message?: string | string[] })?.message;
    const safeMessage = Array.isArray(message) ? message.join(', ') : message ?? 'Request failed.';
    const authPath = request.path.startsWith('/auth/') || request.path.startsWith('/admin/');
    let code: AuthErrorCode | undefined;
    if (authPath) {
      if (status === HttpStatus.TOO_MANY_REQUESTS) code = AuthErrorCode.RATE_LIMITED;
      else if (status === HttpStatus.UNAUTHORIZED) code = AuthErrorCode.INVALID_CREDENTIALS;
      else if (status === HttpStatus.FORBIDDEN && /PIN/i.test(safeMessage)) code = AuthErrorCode.PIN_CHANGE_REQUIRED;
    }
    response.status(status).json({ statusCode: status, ...(code ? { code } : {}), message: safeMessage });
  }
}
