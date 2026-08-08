import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('system_audit_logs')
@Index('idx_system_audit_created_at', ['createdAt'])
@Index('idx_system_audit_actor', ['actor'])
@Index('idx_system_audit_route', ['route'])
@Index('idx_system_audit_request_id', ['requestId'])
export class SystemAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 16 })
  method!: string;

  @Column({ type: 'varchar', length: 512 })
  route!: string;

  @Column({ type: 'varchar', length: 128 })
  actor!: string;

  @Column({ name: 'request_id', type: 'varchar', length: 128, nullable: true })
  requestId!: string | null;

  @Column({ name: 'status_code', type: 'integer' })
  statusCode!: number;

  @Column({ name: 'duration_ms', type: 'integer' })
  durationMs!: number;

  @Column({ type: 'varchar', length: 32 })
  result!: string;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @Column({ name: 'payload_hash', type: 'varchar', length: 64, nullable: true })
  payloadHash!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
