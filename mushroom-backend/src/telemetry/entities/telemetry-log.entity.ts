import { Entity, PrimaryColumn, Column } from 'typeorm';

const numericTransformer = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v != null ? parseFloat(v) : null),
};

@Entity('telemetry_logs', { synchronize: false })
export class TelemetryLog {
  @PrimaryColumn({ name: 'time', type: 'timestamptz' })
  time: Date;

  @PrimaryColumn({ name: 'batch_id', type: 'varchar', length: 50 })
  batchId: string;

  @Column({ name: 'house_id', type: 'varchar', length: 50 })
  houseId: string;

  @Column({ name: 'crop_day_int', type: 'integer' })
  cropDayInt: number;

  @Column('numeric', {
    name: 'humidity_measured',
    precision: 4,
    scale: 1,
    nullable: true,
    transformer: numericTransformer,
  })
  humidityMeasured: number | null;

  @Column('numeric', {
    name: 'temperature_measured',
    precision: 4,
    scale: 1,
    nullable: true,
    transformer: numericTransformer,
  })
  temperatureMeasured: number | null;

  @Column({ name: 'co2_measured', type: 'integer', nullable: true })
  co2Measured: number | null;

  @Column('numeric', {
    name: 'humidity_setpoint',
    precision: 4,
    scale: 1,
    nullable: true,
    transformer: numericTransformer,
  })
  humiditySetpoint: number | null;

  @Column('numeric', {
    name: 'temperature_setpoint',
    precision: 4,
    scale: 1,
    nullable: true,
    transformer: numericTransformer,
  })
  temperatureSetpoint: number | null;

  @Column('numeric', {
    name: 'humidity_error_delta',
    precision: 4,
    scale: 1,
    nullable: true,
    transformer: numericTransformer,
  })
  humidityErrorDelta: number | null;

  @Column('numeric', {
    name: 'temperature_error_delta',
    precision: 4,
    scale: 1,
    nullable: true,
    transformer: numericTransformer,
  })
  temperatureErrorDelta: number | null;

  @Column({ name: 'mist_generator_active', type: 'boolean', nullable: true })
  mistGeneratorActive: boolean | null;

  @Column({ name: 'convection_fan_active', type: 'boolean', nullable: true })
  convectionFanActive: boolean | null;

  @Column({ name: 'heating_lamp_active', type: 'boolean', nullable: true })
  heatingLampActive: boolean | null;

  @Column({ name: 'lamp_stage_active', type: 'boolean', nullable: true })
  lampStageActive: boolean | null;

  @Column({ name: 'lamp_stage2_active', type: 'boolean', nullable: true })
  lampStage2Active: boolean | null;

  @Column({ name: 'heater_water_active', type: 'boolean', nullable: true })
  heaterWaterActive: boolean | null;

  @Column({ name: 'midday_blackout_active', type: 'boolean', nullable: true })
  middayBlackoutActive: boolean | null;
}
