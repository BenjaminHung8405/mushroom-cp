import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TuningSseTicketService } from '../services/tuning-sse-ticket.service';
import {
  DEVICES_SERVICE,
  type DevicesServiceContract,
} from '../../device/devices.service';

interface TicketRequest extends Request {
  params: Request['params'] & { id?: unknown };
  query: Request['query'] & { ticket?: unknown };
}

/** Validates the one-time EventSource credential without accepting JWTs in URLs. */
@Injectable()
export class TuningSseTicketGuard implements CanActivate {
  constructor(
    private readonly tickets: TuningSseTicketService,
    @Inject(DEVICES_SERVICE)
    private readonly devicesService: DevicesServiceContract,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TicketRequest>();
    const deviceId = request.params.id;
    if (typeof deviceId !== 'string' || !deviceId.trim()) {
      throw new UnauthorizedException(
        'A valid tuning stream ticket is required.',
      );
    }

    const ticket = await this.tickets.consumeTicket(request.query.ticket, deviceId);
    const owned = await this.devicesService.isDeviceOwnedByUser(
      ticket.deviceId,
      ticket.userId,
    );
    if (!owned) {
      throw new ForbiddenException('Device ownership could not be verified.');
    }
    return true;
  }
}
