import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDevicesToken1720656000003 implements MigrationInterface {
  name = 'AddDevicesToken1720656000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS token VARCHAR(64)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(token)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_devices_token`);
    await queryRunner.query(`ALTER TABLE devices DROP COLUMN IF EXISTS token`);
  }
}
