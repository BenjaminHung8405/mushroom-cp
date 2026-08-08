import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserRole {
  ADMIN = 'ADMIN',
  OPERATOR = 'OPERATOR',
  AUDITOR = 'AUDITOR',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid') id!: string;
  /** Phone number in E.164 format, e.g. +84901234567 */
  @Column({ name: 'phone_number', type: 'varchar', length: 15, unique: true })
  phoneNumber!: string;
  /** Argon2id hash of the 6-digit PIN */
  @Column({ name: 'pin_hash', type: 'varchar', length: 255 }) pinHash!: string;
  /** User's full display name, optional */
  @Column({ name: 'full_name', type: 'varchar', length: 100, nullable: true })
  fullName!: string | null;
  /** Agriculture preset icon ID, default 'sprout' */
  @Column({ type: 'varchar', length: 50, nullable: true, default: 'sprout' })
  avatar!: string | null;
  @Column({ type: 'varchar', length: 16 }) role!: UserRole;
  @Column({ name: 'is_active', default: true }) isActive!: boolean;
  /** True when the user must set a new PIN before accessing the app */
  @Column({ name: 'must_set_pin', default: true }) mustSetPin!: boolean;
  /** Consecutive failed PIN attempts; reset to 0 on success */
  @Column({ name: 'pin_failed_attempts', default: 0 })
  pinFailedAttempts!: number;
  /** If set and in the future, login is temporarily blocked */
  @Column({ name: 'pin_locked_until', type: 'timestamptz', nullable: true })
  pinLockedUntil!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
