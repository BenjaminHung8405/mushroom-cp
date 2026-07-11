import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MushroomHouse } from '../../batch/entities/mushroom-house.entity';

/**
 * Device registry: maps MQTT identity (device_id) to a physical house.
 * device_id MUST equal EMQX username and MQTT clientId (ACL uses ${username}).
 */
@Entity('devices')
export class Device {
  @PrimaryColumn({ name: 'device_id', type: 'varchar', length: 50 })
  deviceId: string;

  @Column({ name: 'house_id', type: 'varchar', length: 50 })
  houseId: string;

  @ManyToOne(() => MushroomHouse, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'house_id' })
  house?: MushroomHouse;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'display_name', type: 'varchar', length: 100, nullable: true })
  displayName: string | null;

  @Column({ name: 'mqtt_username', type: 'varchar', length: 50, unique: true })
  mqttUsername: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
