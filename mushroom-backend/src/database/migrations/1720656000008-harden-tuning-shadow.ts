import { MigrationInterface, QueryRunner } from 'typeorm';

/** Safely upgrades databases that applied the initial Track-F migrations. */
export class HardenTuningShadow1720656000008 implements MigrationInterface {
  name = 'HardenTuningShadow1720656000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'uq_device_tuning_configs_device_command'
            AND conrelid = 'device_tuning_configurations'::regclass
        ) THEN
          ALTER TABLE device_tuning_configurations
            ADD CONSTRAINT uq_device_tuning_configs_device_command UNIQUE (device_id, command_id);
        END IF;
      END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'uq_device_tuning_configs_device_revision'
            AND conrelid = 'device_tuning_configurations'::regclass
        ) THEN
          ALTER TABLE device_tuning_configurations
            ADD CONSTRAINT uq_device_tuning_configs_device_revision UNIQUE (device_id, revision);
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE device_tuning_configurations
        ADD COLUMN IF NOT EXISTS retained_clear_pending BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS retained_clear_attempts INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS retained_clear_next_at TIMESTAMPTZ
    `);
    await queryRunner.query(`
      DO $$
      DECLARE constraint_name text;
      BEGIN
        FOR constraint_name IN
          SELECT conname FROM pg_constraint
          WHERE conrelid = 'tuning_audit_logs'::regclass AND contype = 'f'
            AND confdeltype = 'c'
        LOOP
          EXECUTE format('ALTER TABLE tuning_audit_logs DROP CONSTRAINT %I', constraint_name);
        END LOOP;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tuning_audit_configuration') THEN
          ALTER TABLE tuning_audit_logs ADD CONSTRAINT fk_tuning_audit_configuration
            FOREIGN KEY (configuration_id) REFERENCES device_tuning_configurations(id) ON DELETE RESTRICT;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_tuning_audit_device') THEN
          ALTER TABLE tuning_audit_logs ADD CONSTRAINT fk_tuning_audit_device
            FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE RESTRICT;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE tuning_audit_logs
        DROP CONSTRAINT IF EXISTS fk_tuning_audit_configuration,
        DROP CONSTRAINT IF EXISTS fk_tuning_audit_device
    `);
    await queryRunner.query(`
      ALTER TABLE tuning_audit_logs
        ADD CONSTRAINT fk_tuning_audit_configuration
          FOREIGN KEY (configuration_id) REFERENCES device_tuning_configurations(id) ON DELETE CASCADE,
        ADD CONSTRAINT fk_tuning_audit_device
          FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
    `);
    await queryRunner.query(`ALTER TABLE device_tuning_configurations
      DROP COLUMN IF EXISTS retained_clear_next_at,
      DROP COLUMN IF EXISTS retained_clear_attempts,
      DROP COLUMN IF EXISTS retained_clear_pending`);
    await queryRunner.query('ALTER TABLE device_tuning_configurations DROP CONSTRAINT IF EXISTS uq_device_tuning_configs_device_command');
    await queryRunner.query('ALTER TABLE device_tuning_configurations DROP CONSTRAINT IF EXISTS uq_device_tuning_configs_device_revision');
  }
}
