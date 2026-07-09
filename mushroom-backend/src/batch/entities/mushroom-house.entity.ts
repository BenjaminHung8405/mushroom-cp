import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('mushroom_houses')
export class MushroomHouse {
  @PrimaryColumn({ type: 'varchar', length: 50 })
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'area_meters', type: 'varchar', length: 20, default: '4x6' })
  areaMeters: string;

  @Column({ name: 'pillar_count', type: 'integer', default: 35 })
  pillarCount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
