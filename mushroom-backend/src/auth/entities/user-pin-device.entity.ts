import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity('user_pin_devices')
@Unique('uq_user_pin_device', ['userId', 'deviceTokenHash'])
@Index('idx_upd_device_token_hash', ['deviceTokenHash'])
@Index('idx_upd_user_id', ['userId'])
export class UserPinDevice {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;

  /** SHA-256 hash of the client-generated device_token UUID */
  @Column({ name: 'device_token_hash', type: 'varchar', length: 64 }) deviceTokenHash!: string;

  @Column({ name: 'device_label', type: 'varchar', length: 100, nullable: true }) deviceLabel!: string | null;

  /** Argon2id hash of the 6-digit PIN bound to this device */
  @Column({ name: 'pin_hash', type: 'varchar', length: 255 }) pinHash!: string;

  /** Per-device failed PIN attempts; reset to 0 on success */
  @Column({ name: 'failed_attempts', default: 0 }) failedAttempts!: number;

  /** If set and in the future, PIN login on this device is temporarily blocked */
  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true }) lockedUntil!: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true }) lastUsedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
