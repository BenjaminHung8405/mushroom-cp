import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TuningSseTicketService } from '../services/tuning-sse-ticket.service';
import type { AuthPrincipal } from '../../auth/auth.types';

interface TicketRequest extends Request {
  params: Request['params'] & { id?: unknown };
  query: Request['query'] & { ticket?: unknown };
  authUser?: AuthPrincipal;
}

/** Validates the one-time EventSource credential without accepting JWTs in URLs. */
@Injectable()
export class TuningSseTicketGuard implements CanActivate {
  constructor(private readonly tickets: TuningSseTicketService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TicketRequest>();
    const deviceId = request.params.id;
    if (typeof deviceId !== 'string' || !deviceId.trim()) {
      throw new UnauthorizedException(
        'A valid tuning stream ticket is required.',
      );
    }
    // Cookie-authenticated same-origin SSE does not need a URL-borne ticket.
    if (request.authUser) return true;

    await this.tickets.consumeTicket(request.query.ticket, deviceId);
    return true;
  }
}
