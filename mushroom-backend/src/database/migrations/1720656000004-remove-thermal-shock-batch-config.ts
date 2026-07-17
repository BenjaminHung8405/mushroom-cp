import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Forward-only safety-policy migration: blackout configuration belongs to the
 * ESP32 hard-safety interlock, never to a crop batch.
 */
export class RemoveThermalShockBatchConfig1720656000004 implements MigrationInterface {
  name = 'RemoveThermalShockBatchConfig1720656000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE crop_batches DROP COLUMN IF EXISTS thermal_shock_protection`);
    await queryRunner.query(`ALTER TABLE crop_batches DROP COLUMN IF EXISTS thermal_shock_start`);
    await queryRunner.query(`ALTER TABLE crop_batches DROP COLUMN IF EXISTS thermal_shock_end`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally no-op. Reintroducing UI-configurable blackout fields would
    // violate the permanent edge-owned safety policy.
  }
}
