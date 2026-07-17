import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { MushroomHouse } from './mushroom-house.entity';

@Entity('crop_batches')
export class CropBatch {
  @PrimaryColumn({ type: 'varchar', length: 50 })
  id: string;

  @Column({ name: 'house_id', type: 'varchar', length: 50 })
  houseId: string;

  @ManyToOne(() => MushroomHouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'house_id' })
  house: MushroomHouse;

  @Column({ name: 'profile_name', type: 'varchar', length: 100 })
  profileName: string;

  @Column({ type: 'varchar', length: 20, default: 'ACTIVE' })
  status: string; // ACTIVE, COMPLETED, ABORTED

  @Column({
    name: 'start_date',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  startDate: Date;

  @Column({ name: 'total_crop_days', type: 'integer' })
  totalCropDays: number;

  @Column({ name: 'spawn_running_end_day', type: 'integer', default: 8 })
  spawnRunningEndDay: number;

  @Column('numeric', {
    name: 'temp_optimal_min',
    precision: 3,
    scale: 1,
    default: 28.0,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => (v != null ? parseFloat(v) : 28.0),
    },
  })
  tempOptimalMin: number;

  @Column('numeric', {
    name: 'temp_optimal_max',
    precision: 3,
    scale: 1,
    default: 35.0,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => (v != null ? parseFloat(v) : 35.0),
    },
  })
  tempOptimalMax: number;

  @Column('numeric', {
    name: 'humidity_optimal_min',
    precision: 3,
    scale: 1,
    default: 70.0,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => (v != null ? parseFloat(v) : 70.0),
    },
  })
  humidityOptimalMin: number;

  @Column('numeric', {
    name: 'humidity_optimal_max',
    precision: 3,
    scale: 1,
    default: 90.0,
    transformer: {
      to: (v: number) => v,
      from: (v: string) => (v != null ? parseFloat(v) : 90.0),
    },
  })
  humidityOptimalMax: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
