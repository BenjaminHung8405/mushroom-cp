import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDevices1720656000000 implements MigrationInterface {
  name = 'CreateDevices1720656000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id VARCHAR(50) PRIMARY KEY,
        house_id VARCHAR(50) NOT NULL REFERENCES mushroom_houses(id) ON DELETE RESTRICT,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        display_name VARCHAR(100),
        mqtt_username VARCHAR(50) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS idx_devices_house ON devices(house_id)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS devices');
  }
}
