import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOfflineSyncReceipts1720656000005 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS offline_sync_receipts (
        device_id VARCHAR(50) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
        boot_count BIGINT NOT NULL,
        chunk_index BIGINT NOT NULL,
        chunk_crc32 BIGINT NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (device_id, boot_count, chunk_index, chunk_crc32)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS offline_sync_receipts');
  }
}
