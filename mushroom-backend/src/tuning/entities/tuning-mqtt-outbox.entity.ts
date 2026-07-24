import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { TuningConfigSnapshot } from './device-tuning-configuration.entity';

export enum TuningMqttOutboxAction {
  PUBLISH_DESIRED = 'PUBLISH_DESIRED',
  CLEAR_RETAINED = 'CLEAR_RETAINED',
}

@Entity('tuning_mqtt_outbox')
export class TuningMqttOutbox {
  @PrimaryColumn({ type: 'uuid' }) id: string;
  @Column({ name: 'device_id', type: 'varchar', length: 50 }) deviceId: string;
  @Column({ name: 'configuration_id', type: 'uuid' }) configurationId: string;
  @Column({ type: 'varchar', length: 20 }) action: TuningMqttOutboxAction;
  @Column({ type: 'integer' }) revision: number;
  @Column({ type: 'jsonb', nullable: true }) payload: TuningConfigSnapshot | null;
  @Column({ type: 'integer', default: 0 }) attempts: number;
  @Column({ name: 'next_attempt_at', type: 'timestamptz' }) nextAttemptAt: Date;
  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true }) deliveredAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
