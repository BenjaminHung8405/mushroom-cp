import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDeviceTuningConfigurations1720656000006 implements MigrationInterface {
  name = 'CreateDeviceTuningConfigurations1720656000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS device_tuning_configurations (
        id UUID PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
        command_id VARCHAR(36) NOT NULL,
        revision INTEGER NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        config JSONB NOT NULL,
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_device_tuning_configs_device_created
      ON device_tuning_configurations(device_id, created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_device_tuning_configs_device_created
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS device_tuning_configurations
    `);
  }
}
