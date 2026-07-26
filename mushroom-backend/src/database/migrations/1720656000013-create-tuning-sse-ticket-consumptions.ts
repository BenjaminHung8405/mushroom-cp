import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shared, durable replay protection for self-authenticating SSE tickets.
 * A unique jti is inserted atomically when a ticket is consumed, so a ticket
 * minted by one API replica can safely be opened through any other replica.
 */
export class CreateTuningSseTicketConsumptions1720656000013
  implements MigrationInterface
{
  name = 'CreateTuningSseTicketConsumptions1720656000013';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tuning_sse_ticket_consumptions (
        jti UUID PRIMARY KEY,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_tuning_sse_ticket_consumptions_expires_at
      ON tuning_sse_ticket_consumptions(expires_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_tuning_sse_ticket_consumptions_expires_at',
    );
    await queryRunner.query('DROP TABLE IF EXISTS tuning_sse_ticket_consumptions');
  }
}
