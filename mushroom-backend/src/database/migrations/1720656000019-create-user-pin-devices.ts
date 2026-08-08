import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserPinDevices1720656000019 implements MigrationInterface {
  name = 'CreateUserPinDevices1720656000019';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE user_pin_devices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_token_hash varchar(64) NOT NULL,
        device_label varchar(100) NULL,
        pin_hash varchar(255) NOT NULL,
        failed_attempts int NOT NULL DEFAULT 0,
        locked_until timestamptz NULL,
        last_used_at timestamptz NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_user_pin_device UNIQUE(user_id, device_token_hash)
      )
    `);
    await q.query(`CREATE INDEX idx_upd_device_token_hash ON user_pin_devices(device_token_hash)`);
    await q.query(`CREATE INDEX idx_upd_user_id ON user_pin_devices(user_id)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS user_pin_devices`);
  }
}
