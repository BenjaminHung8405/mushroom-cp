import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTuningAuditLogs1720656000007 implements MigrationInterface {
  name = 'CreateTuningAuditLogs1720656000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tuning_audit_logs (
        id UUID PRIMARY KEY,
        configuration_id UUID NOT NULL,
        device_id VARCHAR(50) NOT NULL,
        actor VARCHAR(100),
        source VARCHAR(50),
        action VARCHAR(50) NOT NULL,
        ruleset_version VARCHAR(20),
        kpi_snapshot JSONB,
        config_before JSONB,
        config_after JSONB,
        reason TEXT,
        result VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_tuning_audit_configuration
          FOREIGN KEY (configuration_id) REFERENCES device_tuning_configurations(id) ON DELETE CASCADE,
        CONSTRAINT fk_tuning_audit_device
          FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_tuning_audit_device_created
      ON tuning_audit_logs(device_id, created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_tuning_audit_device_created
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS tuning_audit_logs
    `);
  }
}
