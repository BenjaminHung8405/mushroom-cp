import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSystemAuditLogs1720656000016 implements MigrationInterface {
  name = 'CreateSystemAuditLogs1720656000016';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE system_audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      method VARCHAR(16) NOT NULL,
      route VARCHAR(512) NOT NULL,
      actor VARCHAR(128) NOT NULL,
      request_id VARCHAR(128),
      status_code INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      result VARCHAR(32) NOT NULL,
      payload JSONB,
      payload_hash VARCHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await queryRunner.query(
      'CREATE INDEX idx_system_audit_created_at ON system_audit_logs(created_at DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_system_audit_actor ON system_audit_logs(actor)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_system_audit_route ON system_audit_logs(route)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_system_audit_request_id ON system_audit_logs(request_id)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS system_audit_logs');
  }
}
