import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('user_house_access')
@Unique('uq_user_house_access', ['userId', 'houseId'])
@Index('idx_user_house_access_user', ['userId'])
@Index('idx_user_house_access_house', ['houseId'])
export class UserHouseAccess {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ name: 'house_id', type: 'varchar', length: 50 }) houseId!: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
