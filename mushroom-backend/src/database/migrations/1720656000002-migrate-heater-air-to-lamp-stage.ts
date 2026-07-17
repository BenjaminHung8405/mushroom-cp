import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrateHeaterAirToLampStage1720656000002 implements MigrationInterface {
  name = 'MigrateHeaterAirToLampStage1720656000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Support both legacy databases (heater_air_active) and fresh databases
    // initialized from the current schema (lamp_stage_active already exists).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'telemetry_logs'
            AND column_name = 'heater_air_active'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'telemetry_logs'
            AND column_name = 'lamp_stage_active'
        ) THEN
          ALTER TABLE telemetry_logs RENAME COLUMN heater_air_active TO lamp_stage_active;
        ELSIF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'telemetry_logs'
            AND column_name = 'heater_air_active'
        ) THEN
          UPDATE telemetry_logs
          SET lamp_stage_active = COALESCE(lamp_stage_active, heater_air_active);
          ALTER TABLE telemetry_logs DROP COLUMN heater_air_active;
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE telemetry_logs ADD COLUMN IF NOT EXISTS lamp_stage2_active BOOLEAN NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE telemetry_logs DROP COLUMN IF EXISTS lamp_stage2_active`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'telemetry_logs'
            AND column_name = 'lamp_stage_active'
        ) AND NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'telemetry_logs'
            AND column_name = 'heater_air_active'
        ) THEN
          ALTER TABLE telemetry_logs RENAME COLUMN lamp_stage_active TO heater_air_active;
        END IF;
      END $$;
    `);
  }
}
