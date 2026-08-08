import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigrateAuthEmailToPhone1720656000018 implements MigrationInterface {
  name = 'MigrateAuthEmailToPhone1720656000018';

  async up(q: QueryRunner): Promise<void> {
    // 1. Add phone_number column (nullable first to allow backfill)
    await q.query(`ALTER TABLE users ADD COLUMN phone_number VARCHAR(15) NULL`);

    // 2. Backfill: convert existing email rows to a placeholder phone.
    //    Admin must re-bootstrap with AUTH_BOOTSTRAP_ADMIN_PHONE after migration.
    //    Rows with no real phone get a sentinel so UNIQUE constraint can be applied.
    await q.query(
      `UPDATE users SET phone_number = '+00000000000' || SUBSTRING(id::text, 1, 4) WHERE phone_number IS NULL`,
    );

    // 3. Enforce NOT NULL + UNIQUE on phone_number
    await q.query(`ALTER TABLE users ALTER COLUMN phone_number SET NOT NULL`);
    await q.query(
      `ALTER TABLE users ADD CONSTRAINT uq_users_phone_number UNIQUE (phone_number)`,
    );

    // 4. Drop old email unique constraint and column
    await q.query(
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key`,
    );
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS email`);

    // 5. Rename password_hash → pin_hash
    await q.query(`ALTER TABLE users RENAME COLUMN password_hash TO pin_hash`);

    // 6. Rename must_change_password → must_set_pin
    await q.query(
      `ALTER TABLE users RENAME COLUMN must_change_password TO must_set_pin`,
    );

    // 7. Add PIN lockout tracking columns
    await q.query(
      `ALTER TABLE users ADD COLUMN pin_failed_attempts INT NOT NULL DEFAULT 0`,
    );
    await q.query(
      `ALTER TABLE users ADD COLUMN pin_locked_until TIMESTAMPTZ NULL`,
    );

    // 8. Rename target_email → target_identifier in auth_security_events
    await q.query(
      `ALTER TABLE auth_security_events RENAME COLUMN target_email TO target_identifier`,
    );

    // 9. Widen target_identifier to accommodate phone numbers (already varchar 255 — no-op but explicit)
    // Already varchar(255), no change needed.
  }

  async down(q: QueryRunner): Promise<void> {
    // Reverse order

    // 8. Restore target_email
    await q.query(
      `ALTER TABLE auth_security_events RENAME COLUMN target_identifier TO target_email`,
    );

    // 7. Remove lockout columns
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS pin_locked_until`);
    await q.query(
      `ALTER TABLE users DROP COLUMN IF EXISTS pin_failed_attempts`,
    );

    // 6. Rename must_set_pin → must_change_password
    await q.query(
      `ALTER TABLE users RENAME COLUMN must_set_pin TO must_change_password`,
    );

    // 5. Rename pin_hash → password_hash
    await q.query(`ALTER TABLE users RENAME COLUMN pin_hash TO password_hash`);

    // 4. Re-add email column
    await q.query(`ALTER TABLE users ADD COLUMN email VARCHAR(255) NULL`);
    await q.query(`UPDATE users SET email = phone_number || '@migrated.local'`);
    await q.query(`ALTER TABLE users ALTER COLUMN email SET NOT NULL`);
    await q.query(
      `ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email)`,
    );

    // 3. Drop phone_number
    await q.query(
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_users_phone_number`,
    );
    await q.query(`ALTER TABLE users DROP COLUMN IF EXISTS phone_number`);
  }
}
