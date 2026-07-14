import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrateHeaterAirToLampStage1720656000002 implements MigrationInterface {
  name = 'MigrateHeaterAirToLampStage1720656000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE telemetry_logs RENAME COLUMN heater_air_active TO lamp_stage_active`,
    );
    await queryRunner.query(
      `ALTER TABLE telemetry_logs ADD COLUMN IF NOT EXISTS lamp_stage2_active BOOLEAN NULL`,
    );
    await queryRunner.query(
      `UPDATE telemetry_logs SET lamp_stage2_active = lamp_stage_active WHERE lamp_stage_active IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE telemetry_logs DROP COLUMN IF EXISTS lamp_stage2_active`,
    );
    await queryRunner.query(
      `ALTER TABLE telemetry_logs RENAME COLUMN lamp_stage_active TO heater_air_active`,
    );
  }
}
