import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditFkIndexes1720656000022 implements MigrationInterface {
  name = 'AddAuditFkIndexes1720656000022';
  transactional = false;

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_devices_owner_user_id ON devices(owner_user_id)`,
    );
    await q.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crop_batches_created_by ON crop_batches(created_by)`,
    );
    await q.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_crop_batches_updated_by ON crop_batches(updated_by)`,
    );
    await q.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_growth_profiles_created_by ON growth_profiles(created_by)`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DROP INDEX CONCURRENTLY IF NOT EXISTS idx_growth_profiles_created_by`,
    );
    await q.query(
      `DROP INDEX CONCURRENTLY IF NOT EXISTS idx_crop_batches_updated_by`,
    );
    await q.query(
      `DROP INDEX CONCURRENTLY IF NOT EXISTS idx_crop_batches_created_by`,
    );
    await q.query(
      `DROP INDEX CONCURRENTLY IF NOT EXISTS idx_devices_owner_user_id`,
    );
  }
}
