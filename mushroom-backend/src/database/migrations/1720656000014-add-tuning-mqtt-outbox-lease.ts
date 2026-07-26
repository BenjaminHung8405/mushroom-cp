import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A durable worker lease lets dispatchers claim an outbox item, commit, then
 * perform broker I/O without retaining PostgreSQL row or advisory locks.
 */
export class AddTuningMqttOutboxLease1720656000014 implements MigrationInterface {
  name = 'AddTuningMqttOutboxLease1720656000014';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tuning_mqtt_outbox
        ADD COLUMN processing_at TIMESTAMPTZ,
        ADD COLUMN lease_expires_at TIMESTAMPTZ,
        ADD COLUMN worker_id UUID
    `);
    await queryRunner.query(`
      CREATE INDEX idx_tuning_mqtt_outbox_claim_due
      ON tuning_mqtt_outbox(next_attempt_at, revision, created_at)
      WHERE delivered_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_tuning_mqtt_outbox_active_device_lease
      ON tuning_mqtt_outbox(device_id, lease_expires_at)
      WHERE delivered_at IS NULL AND lease_expires_at IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_tuning_mqtt_outbox_active_device_lease',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_tuning_mqtt_outbox_claim_due',
    );
    await queryRunner.query(`
      ALTER TABLE tuning_mqtt_outbox
        DROP COLUMN IF EXISTS worker_id,
        DROP COLUMN IF EXISTS lease_expires_at,
        DROP COLUMN IF EXISTS processing_at
    `);
  }
}
