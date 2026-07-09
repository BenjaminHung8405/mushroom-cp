import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { GrowthProfile } from './growth-profile.entity';
import { CropBatch } from './crop-batch.entity';

@Entity('light_schedule_blocks')
export class LightScheduleBlock {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'profile_id', type: 'varchar', length: 50, nullable: true })
  profileId: string | null;

  @ManyToOne(() => GrowthProfile, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'profile_id' })
  profile: GrowthProfile | null;

  @Column({ name: 'batch_id', type: 'varchar', length: 50, nullable: true })
  batchId: string | null;

  @ManyToOne(() => CropBatch, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'batch_id' })
  batch: CropBatch | null;

  @Column({ name: 'start_day', type: 'integer' })
  startDay: number;

  @Column({ name: 'end_day', type: 'integer' })
  endDay: number;

  @Column({ name: 'status', type: 'varchar', length: 5 })
  status: 'ON' | 'OFF';
}
