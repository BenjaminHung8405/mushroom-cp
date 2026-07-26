import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDevicesOwnerUserId1720656000011 implements MigrationInterface {
  name = 'AddDevicesOwnerUserId1720656000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE devices ADD COLUMN IF NOT EXISTS owner_user_id VARCHAR(255)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE devices DROP COLUMN IF EXISTS owner_user_id',
    );
  }
}
