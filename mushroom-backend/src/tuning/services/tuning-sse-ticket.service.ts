import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { DataSource } from 'typeorm';

export interface ConsumedSseTicket {
  readonly deviceId: string;
  readonly userId: string;
}

interface SignedSseTicket extends ConsumedSseTicket {
  readonly expiresAt: number;
  readonly jti: string;
}

type UnknownTicketPayload = {
  userId?: unknown;
  deviceId?: unknown;
  expiresAt?: unknown;
  jti?: unknown;
};

const TICKET_TTL_MS = 30_000;
const TICKET_CLOCK_SKEW_MS = 1_000;

/**
 * Issues short-lived, self-authenticating credentials for native EventSource.
 * The browser cannot attach Authorization headers to EventSource, so the JWT
 * is verified only while minting this ticket. A signed ticket can be verified
 * by every replica; a durable, atomic jti insert makes it single-use.
 */
@Injectable()
export class TuningSseTicketService {
  private readonly signingKey: Buffer;

  constructor(private readonly dataSource: DataSource) {
    const secret = process.env.TUNING_SSE_TICKET_SECRET;
    if (
      !secret ||
      secret.trim().length === 0 ||
      Buffer.byteLength(secret, 'utf8') < 32
    ) {
      throw new Error('TUNING_SSE_TICKET_SECRET must be at least 32 bytes.');
    }
    if (secret === process.env.JWT_SECRET) {
      throw new Error('TUNING_SSE_TICKET_SECRET must differ from JWT_SECRET.');
    }
    this.signingKey = Buffer.from(secret, 'utf8');
  }

  createTicket(userId: string, deviceId: string): string {
    const payload: SignedSseTicket = {
      userId,
      deviceId,
      expiresAt: Date.now() + TICKET_TTL_MS,
      jti: crypto.randomUUID(),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    return `${encodedPayload}.${this.sign(encodedPayload)}`;
  }

  async consumeTicket(
    ticket: unknown,
    deviceId: string,
  ): Promise<ConsumedSseTicket> {
    const payload = this.verifyTicket(ticket, deviceId);
    try {
      // Bounded TTL retention: expiry is still enforced cryptographically, and
      // this cleanup keeps the shared replay table from growing indefinitely.
      await this.dataSource.query(
        'DELETE FROM tuning_sse_ticket_consumptions WHERE expires_at <= NOW()',
      );
      const inserted: unknown = await this.dataSource.query(
        `INSERT INTO tuning_sse_ticket_consumptions(jti, expires_at)
         VALUES ($1, to_timestamp($2 / 1000.0))
         ON CONFLICT (jti) DO NOTHING
         RETURNING jti`,
        [payload.jti, payload.expiresAt],
      );
      if (!Array.isArray(inserted) || inserted.length !== 1) {
        throw this.invalidTicket();
      }
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) throw error;
      throw new ServiceUnavailableException(
        'Unable to establish tuning stream.',
      );
    }
    return { userId: payload.userId, deviceId: payload.deviceId };
  }

  private verifyTicket(ticket: unknown, deviceId: string): SignedSseTicket {
    if (typeof ticket !== 'string') throw this.invalidTicket();
    const parts = ticket.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1])
      throw this.invalidTicket();
    const [encodedPayload, signature] = parts;
    const expectedSignature = Buffer.from(this.sign(encodedPayload));
    const receivedSignature = Buffer.from(signature);
    if (
      expectedSignature.length !== receivedSignature.length ||
      !crypto.timingSafeEqual(expectedSignature, receivedSignature)
    )
      throw this.invalidTicket();
    try {
      const payload: UnknownTicketPayload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as UnknownTicketPayload;
      if (!this.isValidPayload(payload, deviceId)) throw this.invalidTicket();
      return payload;
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) throw error;
      throw this.invalidTicket();
    }
  }

  private isValidPayload(
    payload: UnknownTicketPayload,
    deviceId: string,
  ): payload is SignedSseTicket {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      typeof payload.userId === 'string' &&
      payload.userId.trim().length > 0 &&
      typeof payload.deviceId === 'string' &&
      payload.deviceId === deviceId &&
      typeof payload.jti === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(
        payload.jti,
      ) &&
      typeof payload.expiresAt === 'number' &&
      Number.isSafeInteger(payload.expiresAt) &&
      payload.expiresAt >= Date.now() - TICKET_CLOCK_SKEW_MS
    );
  }

  private sign(encodedPayload: string): string {
    return crypto
      .createHmac('sha256', this.signingKey)
      .update(encodedPayload)
      .digest('base64url');
  }

  private invalidTicket(): UnauthorizedException {
    return new UnauthorizedException(
      'A valid tuning stream ticket is required.',
    );
  }
}
