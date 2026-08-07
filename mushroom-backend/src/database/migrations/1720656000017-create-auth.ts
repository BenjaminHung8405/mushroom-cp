import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuth1720656000017 implements MigrationInterface {
  name = 'CreateAuth1720656000017';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await q.query(`CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(255) NOT NULL UNIQUE, password_hash varchar(255) NOT NULL, role varchar(16) NOT NULL CHECK (role IN ('ADMIN','OPERATOR','AUDITOR')), is_active boolean NOT NULL DEFAULT true, must_change_password boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE user_house_access (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, house_id varchar(50) NOT NULL REFERENCES mushroom_houses(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT uq_user_house_access UNIQUE(user_id, house_id))`);
    await q.query(`CREATE INDEX idx_user_house_access_user ON user_house_access(user_id); CREATE INDEX idx_user_house_access_house ON user_house_access(house_id)`);
    await q.query(`CREATE TABLE auth_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash varchar(64) NOT NULL UNIQUE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, ip_address varchar(45), user_agent varchar(512), issued_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, idle_expires_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz NULL)`);
    await q.query(`CREATE INDEX idx_auth_sessions_token_active ON auth_sessions(token_hash) WHERE revoked_at IS NULL; CREATE INDEX idx_auth_sessions_user_active ON auth_sessions(user_id) WHERE revoked_at IS NULL`);
    await q.query(`CREATE TABLE auth_security_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_type varchar(64) NOT NULL, actor_id uuid REFERENCES users(id) ON DELETE SET NULL, target_email varchar(255), ip_address varchar(45), user_agent varchar(255), status varchar(16) NOT NULL, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE INDEX idx_auth_events_created_at ON auth_security_events(created_at); CREATE INDEX idx_auth_events_actor ON auth_security_events(actor_id)`);
  }
  async down(q: QueryRunner): Promise<void> { await q.query('DROP TABLE IF EXISTS auth_security_events, auth_sessions, user_house_access, users'); }
}
