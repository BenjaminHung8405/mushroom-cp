import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTuningRecommendations1720656000015 implements MigrationInterface {
  name = 'CreateTuningRecommendations1720656000015';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE tuning_recommendations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), device_id VARCHAR(50) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
      observation_date DATE NOT NULL, status VARCHAR(24) NOT NULL, block_reason VARCHAR(64), block_reason_detail TEXT,
      raw_kpi_snapshot JSONB, current_config_snapshot JSONB, advisory_snapshot JSONB,
      applied_configuration_id UUID REFERENCES device_tuning_configurations(id) ON DELETE SET NULL,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), applied_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT tuning_recommendation_status_check CHECK (status IN ('PENDING','APPLIED','INSUFFICIENT_DATA')),
      CONSTRAINT uq_tuning_recommendation_device_date UNIQUE (device_id, observation_date)
    )`);
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query('DROP TABLE IF EXISTS tuning_recommendations'); }
}
