import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserFullnameAndAvatar1720656000020 implements MigrationInterface {
  name = 'AddUserFullnameAndAvatar1720656000020';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE users
      ADD COLUMN full_name varchar(100) NULL,
      ADD COLUMN avatar varchar(50) NULL DEFAULT 'sprout'
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE users
      DROP COLUMN IF EXISTS full_name,
      DROP COLUMN IF EXISTS avatar
    `);
  }
}
