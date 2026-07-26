import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Release gate for Track J ownership enforcement.
 *
 * Before applying this migration, the release operator must populate
 * `device_owner_migration_map(device_id, owner_user_id)` from the canonical
 * identity/house-assignment system. The table is intentionally a staging
 * contract instead of guessing from JWT claims or assigning a blanket admin.
 */
export class BackfillAndEnforceDevicesOwnerUserId1720656000012 implements MigrationInterface {
  name = 'BackfillAndEnforceDevicesOwnerUserId1720656000012';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const unmapped = (await queryRunner.query(`
      SELECT d.device_id
      FROM devices d
      LEFT JOIN device_owner_migration_map m ON m.device_id = d.device_id
      WHERE NULLIF(BTRIM(d.owner_user_id), '') IS NULL
        AND (m.device_id IS NULL OR NULLIF(BTRIM(m.owner_user_id), '') IS NULL)
      LIMIT 1
    `)) as Array<{ device_id: string }>;
    if (unmapped.length > 0) {
      throw new Error(
        `Ownership rollout blocked: device ${unmapped[0].device_id} has no canonical owner mapping. ` +
          'Populate device_owner_migration_map from the approved ownership source and rerun.',
      );
    }

    await queryRunner.query(`
      UPDATE devices d
      SET owner_user_id = BTRIM(m.owner_user_id)
      FROM device_owner_migration_map m
      WHERE d.device_id = m.device_id
        AND NULLIF(BTRIM(d.owner_user_id), '') IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE devices
        ADD CONSTRAINT chk_devices_owner_user_id_nonblank
        CHECK (NULLIF(BTRIM(owner_user_id), '') IS NOT NULL) NOT VALID
    `);
    await queryRunner.query(
      'ALTER TABLE devices VALIDATE CONSTRAINT chk_devices_owner_user_id_nonblank',
    );
    await queryRunner.query(
      'ALTER TABLE devices ALTER COLUMN owner_user_id SET NOT NULL',
    );
    await queryRunner.query('DROP TABLE device_owner_migration_map');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE devices ALTER COLUMN owner_user_id DROP NOT NULL',
    );
    await queryRunner.query(
      'ALTER TABLE devices DROP CONSTRAINT IF EXISTS chk_devices_owner_user_id_nonblank',
    );
  }
}
