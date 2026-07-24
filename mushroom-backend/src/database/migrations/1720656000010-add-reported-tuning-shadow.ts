import { MigrationInterface, QueryRunner } from 'typeorm';

/** Persists firmware-authoritative effective tuning evidence for canonical ACK checks. */
export class AddReportedTuningShadow1720656000010 implements MigrationInterface {
  name = 'AddReportedTuningShadow1720656000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE device_tuning_configurations
        ADD COLUMN IF NOT EXISTS reported_config JSONB,
        ADD COLUMN IF NOT EXISTS reported_revision INTEGER,
        ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS rejection_reason VARCHAR(64)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_device_tuning_configs_device_revision
      ON device_tuning_configurations(device_id, revision DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_device_tuning_configs_device_revision');
    await queryRunner.query(`
      ALTER TABLE device_tuning_configurations
        DROP COLUMN IF EXISTS rejection_reason,
        DROP COLUMN IF EXISTS applied_at,
        DROP COLUMN IF EXISTS reported_revision,
        DROP COLUMN IF EXISTS reported_config
    `);
  }
}
