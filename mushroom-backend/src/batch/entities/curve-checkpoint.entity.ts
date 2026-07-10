import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { GrowthProfile } from './growth-profile.entity';
import { CropBatch } from './crop-batch.entity';

@Entity('curve_checkpoints')
@Index('idx_checkpoints_batch', ['batchId', 'metricType'])
export class CurveCheckpoint {
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

  @Column({ name: 'metric_type', type: 'varchar', length: 20 })
  metricType: 'TEMPERATURE' | 'HUMIDITY';

  @Column({ name: 'crop_day', type: 'integer' })
  cropDay: number;

  @Column('numeric', {
    name: 'target_value',
    precision: 4,
    scale: 1,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => (v != null ? parseFloat(v) : null),
    },
  })
  targetValue: number;
}
