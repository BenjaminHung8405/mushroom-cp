import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('auth_security_events')
@Index('idx_auth_events_created_at', ['createdAt'])
@Index('idx_auth_events_actor', ['actorId'])
export class AuthSecurityEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'event_type', type: 'varchar', length: 64 }) eventType!: string;
  @Column({ name: 'actor_id', type: 'uuid', nullable: true }) actorId!: string | null;
  /** Phone number, email, or other identifier of the subject of the event */
  @Column({ name: 'target_identifier', type: 'varchar', length: 255, nullable: true }) targetIdentifier!: string | null;
  @Column({ name: 'ip_address', type: 'varchar', length: 45, nullable: true }) ipAddress!: string | null;
  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true }) userAgent!: string | null;
  @Column({ type: 'varchar', length: 16 }) status!: string;
  @Column({ type: 'jsonb', nullable: true }) metadata!: Record<string, unknown> | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}

