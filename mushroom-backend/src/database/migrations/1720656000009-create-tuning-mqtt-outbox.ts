import { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable, per-device serialized MQTT side-effect queue for tuning desired/clear. */
export class CreateTuningMqttOutbox1720656000009 implements MigrationInterface {
  name = 'CreateTuningMqttOutbox1720656000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tuning_mqtt_outbox (
        id UUID PRIMARY KEY,
        device_id VARCHAR(50) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
        configuration_id UUID NOT NULL REFERENCES device_tuning_configurations(id) ON DELETE CASCADE,
        action VARCHAR(20) NOT NULL CHECK (action IN ('PUBLISH_DESIRED', 'CLEAR_RETAINED')),
        revision INTEGER NOT NULL,
        payload JSONB,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        delivered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_tuning_mqtt_outbox_configuration_action UNIQUE (configuration_id, action)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_tuning_mqtt_outbox_device_due
      ON tuning_mqtt_outbox(device_id, next_attempt_at, revision)
      WHERE delivered_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_tuning_mqtt_outbox_device_due');
    await queryRunner.query('DROP TABLE IF EXISTS tuning_mqtt_outbox');
  }
}
