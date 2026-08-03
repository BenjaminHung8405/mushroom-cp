import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Device } from '../../device/entities/device.entity';
import { DeviceTuningConfiguration } from './device-tuning-configuration.entity';

export enum TuningRecommendationStatus {
  PENDING = 'PENDING',
  APPLIED = 'APPLIED',
  INSUFFICIENT_DATA = 'INSUFFICIENT_DATA',
}

@Entity('tuning_recommendations')
@Index('uq_tuning_recommendation_device_date', ['deviceId', 'observationDate'], {
  unique: true,
})
export class TuningRecommendation {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'device_id', type: 'varchar', length: 50 }) deviceId!: string;
  @ManyToOne(() => Device, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'device_id' }) device?: Device;
  @Column({ name: 'observation_date', type: 'date' }) observationDate!: string;
  @Column({ type: 'varchar', length: 24 }) status!: TuningRecommendationStatus;
  @Column({ name: 'block_reason', type: 'varchar', length: 64, nullable: true }) blockReason!: string | null;
  @Column({ name: 'block_reason_detail', type: 'text', nullable: true }) blockReasonDetail!: string | null;
  @Column({ name: 'raw_kpi_snapshot', type: 'jsonb', nullable: true }) rawKpiSnapshot!: Record<string, unknown> | null;
  @Column({ name: 'current_config_snapshot', type: 'jsonb', nullable: true }) currentConfigSnapshot!: Record<string, unknown> | null;
  @Column({ name: 'advisory_snapshot', type: 'jsonb', nullable: true }) advisorySnapshot!: Record<string, unknown> | null;
  @Column({ name: 'applied_configuration_id', type: 'uuid', nullable: true }) appliedConfigurationId!: string | null;
  @ManyToOne(() => DeviceTuningConfiguration, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'applied_configuration_id' }) appliedConfiguration?: DeviceTuningConfiguration | null;
  @Column({ name: 'generated_at', type: 'timestamptz', default: () => 'NOW()' }) generatedAt!: Date;
  @Column({ name: 'applied_at', type: 'timestamptz', nullable: true }) appliedAt!: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
}
