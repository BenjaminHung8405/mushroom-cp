import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('auth_sessions')
@Index('idx_auth_sessions_token_active', ['tokenHash'], { where: 'revoked_at IS NULL' })
@Index('idx_auth_sessions_user_active', ['userId'], { where: 'revoked_at IS NULL' })
export class AuthSession {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true }) tokenHash!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true }) ipAddress!: string | null;
  @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true }) userAgent!: string | null;
  @CreateDateColumn({ name: 'issued_at', type: 'timestamptz' }) issuedAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
  @Column({ name: 'idle_expires_at', type: 'timestamptz' }) idleExpiresAt!: Date;
  @Column({ name: 'last_seen_at', type: 'timestamptz' }) lastSeenAt!: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
}
