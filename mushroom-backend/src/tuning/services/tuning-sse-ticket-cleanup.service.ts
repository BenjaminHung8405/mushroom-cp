import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 1_000;

/**
 * Performs bounded replay-record retention outside the SSE request path.
 * Ticket expiry is enforced by signature validation, so cleanup is strictly
 * operational housekeeping and must never delay an EventSource reconnect.
 */
@Injectable()
export class TuningSseTicketCleanupService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TuningSseTicketCleanupService.name);
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(private readonly dataSource: DataSource) {}

  onModuleInit(): void {
    this.cleanupTimer = setInterval(() => {
      void this.deleteExpiredBatch();
    }, CLEANUP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async deleteExpiredBatch(): Promise<void> {
    try {
      await this.dataSource.query(
        `DELETE FROM tuning_sse_ticket_consumptions
         WHERE jti IN (
           SELECT jti
           FROM tuning_sse_ticket_consumptions
           WHERE expires_at <= NOW()
           ORDER BY expires_at
           LIMIT $1
         )`,
        [CLEANUP_BATCH_SIZE],
      );
    } catch (error: unknown) {
      this.logger.error('Unable to clean expired tuning SSE tickets', error);
    }
  }
}
