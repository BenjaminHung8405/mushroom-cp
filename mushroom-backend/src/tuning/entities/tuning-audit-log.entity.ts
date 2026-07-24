import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Device } from '../../device/entities/device.entity';
import {
  DeviceTuningConfiguration,
  TuningConfigSnapshot,
} from './device-tuning-configuration.entity';

@Entity('tuning_audit_logs')
@Index('idx_tuning_audit_device_created', ['deviceId', 'createdAt'])
export class TuningAuditLog {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'configuration_id', type: 'uuid' })
  configurationId: string;

  @ManyToOne(() => DeviceTuningConfiguration, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'configuration_id' })
  configuration?: DeviceTuningConfiguration;

  @Column({ name: 'device_id', type: 'varchar', length: 50 })
  deviceId: string;

  @ManyToOne(() => Device, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' })
  device?: Device;

  @Column({ type: 'varchar', length: 100, nullable: true })
  actor: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  source: string | null;

  @Column({ type: 'varchar', length: 50 })
  action: string;

  @Column({
    name: 'ruleset_version',
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  rulesetVersion: string | null;

  @Column({ name: 'kpi_snapshot', type: 'jsonb', nullable: true })
  kpiSnapshot: Record<string, any> | null;

  @Column({ name: 'config_before', type: 'jsonb', nullable: true })
  configBefore: TuningConfigSnapshot | null;

  @Column({ name: 'config_after', type: 'jsonb', nullable: true })
  configAfter: TuningConfigSnapshot | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 20 })
  result: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
