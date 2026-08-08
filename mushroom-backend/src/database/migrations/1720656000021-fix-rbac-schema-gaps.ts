import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixRbacSchemaGaps1720656000021 implements MigrationInterface {
  name = 'FixRbacSchemaGaps1720656000021';

  async up(q: QueryRunner): Promise<void> {
    // 1. Devices: drop NOT NULL and old check constraint, cast to UUID safely with regex, add FK ON DELETE SET NULL
    await q.query(
      `ALTER TABLE devices DROP CONSTRAINT IF EXISTS chk_devices_owner_user_id_nonblank`,
    );
    await q.query(
      `ALTER TABLE devices ALTER COLUMN owner_user_id DROP NOT NULL`,
    );
    await q.query(`
      ALTER TABLE devices 
      ALTER COLUMN owner_user_id TYPE UUID 
      USING (
        CASE 
          WHEN owner_user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
          THEN owner_user_id::uuid 
          ELSE NULL 
        END
      )
    `);
    await q.query(
      `ALTER TABLE devices DROP CONSTRAINT IF EXISTS fk_devices_owner_user`,
    );
    await q.query(`
      ALTER TABLE devices
      ADD CONSTRAINT fk_devices_owner_user 
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
    `);

    // 2. Growth Profiles: Add created_by & is_system
    await q.query(`
      ALTER TABLE growth_profiles
      ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE
    `);

    // 3. Crop Batches: Add created_by & updated_by
    await q.query(`
      ALTER TABLE crop_batches
      ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL
    `);

    // 4. Auth Security Events: Add actor_phone_snapshot & actor_role_snapshot
    await q.query(`
      ALTER TABLE auth_security_events
      ADD COLUMN IF NOT EXISTS actor_phone_snapshot VARCHAR(15),
      ADD COLUMN IF NOT EXISTS actor_role_snapshot VARCHAR(32)
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE auth_security_events
      DROP COLUMN IF EXISTS actor_phone_snapshot,
      DROP COLUMN IF EXISTS actor_role_snapshot
    `);

    await q.query(`
      ALTER TABLE crop_batches
      DROP COLUMN IF EXISTS created_by,
      DROP COLUMN IF EXISTS updated_by
    `);

    await q.query(`
      ALTER TABLE growth_profiles
      DROP COLUMN IF EXISTS created_by,
      DROP COLUMN IF EXISTS is_system
    `);

    await q.query(`
      ALTER TABLE devices
      DROP CONSTRAINT IF EXISTS fk_devices_owner_user
    `);

    await q.query(`
      UPDATE devices SET owner_user_id = 'UNASSIGNED' WHERE owner_user_id IS NULL
    `);

    await q.query(`
      ALTER TABLE devices
      ALTER COLUMN owner_user_id TYPE VARCHAR(255) USING owner_user_id::text
    `);

    await q.query(`
      ALTER TABLE devices
      ALTER COLUMN owner_user_id SET NOT NULL
    `);

    await q.query(`
      ALTER TABLE devices
      ADD CONSTRAINT chk_devices_owner_user_id_nonblank CHECK (length(trim(owner_user_id)) > 0)
    `);
  }
}
