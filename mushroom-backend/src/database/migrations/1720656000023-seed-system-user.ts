import { MigrationInterface, QueryRunner } from 'typeorm';

export const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

export class SeedSystemUser1720656000023 implements MigrationInterface {
  name = 'SeedSystemUser1720656000023';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO users (id, phone_number, pin_hash, role, full_name, is_active, must_set_pin)
      VALUES (
        '${SYSTEM_USER_ID}',
        'SYSTEM',
        '!SYSTEM_ACCOUNT_LOCKED!',
        'ADMIN',
        'System Automation Worker',
        false,
        false
      )
      ON CONFLICT (id) DO UPDATE SET is_active = false, pin_hash = '!SYSTEM_ACCOUNT_LOCKED!';
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM users WHERE id = '${SYSTEM_USER_ID}'`);
  }
}
