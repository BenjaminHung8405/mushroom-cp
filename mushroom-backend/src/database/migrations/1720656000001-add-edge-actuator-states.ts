import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEdgeActuatorStates1720656000001 implements MigrationInterface {
  name = 'AddEdgeActuatorStates1720656000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE telemetry_logs ADD COLUMN IF NOT EXISTS heater_air_active BOOLEAN NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE telemetry_logs ADD COLUMN IF NOT EXISTS heater_water_active BOOLEAN NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE telemetry_logs ALTER COLUMN mist_generator_active DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE telemetry_logs ALTER COLUMN convection_fan_active DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE telemetry_logs ALTER COLUMN midday_blackout_active DROP NOT NULL`,
    );
    // Historical rows were backend-derived. They must not be presented as edge-confirmed.
    await queryRunner.query(
      `UPDATE telemetry_logs SET mist_generator_active = NULL, convection_fan_active = NULL, midday_blackout_active = NULL, heater_air_active = NULL, heater_water_active = NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE telemetry_logs DROP COLUMN IF EXISTS heater_water_active`,
    );
    await queryRunner.query(
      `ALTER TABLE telemetry_logs DROP COLUMN IF EXISTS heater_air_active`,
    );
  }
}
