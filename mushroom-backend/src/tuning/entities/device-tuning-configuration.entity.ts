import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Device } from '../../device/entities/device.entity';

export enum SyncStatus {
  PENDING = 'PENDING',
  IN_SYNC = 'IN_SYNC',
  REJECTED = 'REJECTED',
}

export interface TuningConfigSnapshot {
  lamp_gain_scale: number;
  mist_gain_scale: number;
  mist_on_threshold: number;
  mist_off_threshold: number;
}

@Entity('device_tuning_configurations')
export class DeviceTuningConfiguration {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'device_id', type: 'varchar', length: 50 })
  deviceId: string;

  @ManyToOne(() => Device, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device?: Device;

  @Column({ name: 'command_id', type: 'varchar', length: 36 })
  commandId: string;

  @Column({ type: 'integer' })
  revision: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: SyncStatus.PENDING,
  })
  status: SyncStatus;

  @Column({ type: 'jsonb' })
  config: TuningConfigSnapshot;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'retained_clear_pending', type: 'boolean', default: false })
  retainedClearPending: boolean;

  @Column({ name: 'retained_clear_attempts', type: 'integer', default: 0 })
  retainedClearAttempts: number;

  @Column({ name: 'retained_clear_next_at', type: 'timestamptz', nullable: true })
  retainedClearNextAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
