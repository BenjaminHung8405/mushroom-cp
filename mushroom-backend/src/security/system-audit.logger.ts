import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import type {
  CallHandler,
  ExecutionContext,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { from, Observable, of } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { Repository } from 'typeorm';
import { SystemAuditLog } from './entities/system-audit-log.entity';

const REDACTED = '[REDACTED]';
const MAX_SERIALIZED_PAYLOAD_BYTES = 32 * 1024;
const SECRET_KEY_PATTERN =
  /authorization|token|password|secret|cookie|credential/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED_DEPTH]';
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => redact(item, depth + 1));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 100)
      .map(([key, item]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(item, depth + 1),
      ]),
  );
}

function boundedPayload(body: unknown): {
  payload: Record<string, unknown> | null;
  hash: string | null;
} {
  if (!body || typeof body !== 'object') return { payload: null, hash: null };
  const safe = redact(body) as Record<string, unknown>;
  const serialized = JSON.stringify(safe);
  if (Buffer.byteLength(serialized, 'utf8') <= MAX_SERIALIZED_PAYLOAD_BYTES) {
    return { payload: safe, hash: null };
  }
  return {
    payload: {
      _truncated: true,
      preview: serialized.slice(0, MAX_SERIALIZED_PAYLOAD_BYTES),
    },
    hash: createHash('sha256').update(serialized).digest('hex'),
  };
}

@Injectable()
export class SystemAuditLogger implements NestInterceptor {
  private readonly logger = new Logger(SystemAuditLogger.name);

  constructor(
    @InjectRepository(SystemAuditLog)
    private readonly repository: Repository<SystemAuditLog>,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context
      .switchToHttp()
      .getRequest<
        Request & {
          user?: { sub?: string };
          authUser?: { id: string; role: string; sessionId: string };
        }
      >();
    const response = context.switchToHttp().getResponse<Response>();
    const actor = request.authUser?.id ?? request.user?.sub;
    if (
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) ||
      !actor
    ) {
      return next.handle();
    }

    const startedAt = Date.now();
    const { payload, hash } = boundedPayload(request.body);
    const requestId = request.header('x-request-id') ?? null;

    const persist = (statusCode: number, result: string) =>
      from(
        this.repository.insert({
          method: request.method,
          route: request.originalUrl ?? request.url,
          actor,
          requestId,
          statusCode,
          durationMs: Date.now() - startedAt,
          result,
          payload: payload
            ? ({
                ...payload,
                _auth: request.authUser
                  ? {
                      role: request.authUser.role,
                      sessionId: request.authUser.sessionId,
                    }
                  : undefined,
              } as unknown as Record<string, never>)
            : null,
          payloadHash: hash,
        }),
      ).pipe(
        catchError((error: unknown) => {
          this.logger.error(
            `Failed to persist system audit record: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Auditing is best effort: do not complete without an emission because
          // Nest turns that into EmptyError ("no elements in sequence") and loses
          // an otherwise successful control-plane response.
          return of(null);
        }),
      );

    return next.handle().pipe(
      mergeMap((value) =>
        persist(response.statusCode, 'SUCCESS').pipe(map(() => value)),
      ),
      catchError((error: unknown) => {
        void persist(
          response.statusCode >= 400 ? response.statusCode : 500,
          'FAILURE',
        ).subscribe();
        throw error;
      }),
    );
  }
}
