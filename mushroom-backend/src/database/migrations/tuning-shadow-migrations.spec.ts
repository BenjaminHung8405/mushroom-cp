import { QueryRunner } from 'typeorm';
import { CreateDeviceTuningConfigurations1720656000006 } from './1720656000006-create-device-tuning-configurations';
import { CreateTuningAuditLogs1720656000007 } from './1720656000007-create-tuning-audit-logs';
import { HardenTuningShadow1720656000008 } from './1720656000008-harden-tuning-shadow';
import { CreateTuningMqttOutbox1720656000009 } from './1720656000009-create-tuning-mqtt-outbox';

describe('tuning shadow migrations', () => {
  const runner = (): jest.Mocked<Pick<QueryRunner, 'query'>> => ({ query: jest.fn().mockResolvedValue(undefined) });

  it('applies and rolls back clean schema in reverse without removing historical migration columns early', async () => {
    const queryRunner = runner();
    const migrations = [
      new CreateDeviceTuningConfigurations1720656000006(),
      new CreateTuningAuditLogs1720656000007(),
      new HardenTuningShadow1720656000008(),
      new CreateTuningMqttOutbox1720656000009(),
    ];
    for (const migration of migrations) await migration.up(queryRunner as QueryRunner);
    for (const migration of [...migrations].reverse()) await migration.down(queryRunner as QueryRunner);

    const sql = queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS device_tuning_configurations');
    expect(sql).toContain('ADD CONSTRAINT uq_device_tuning_configs_device_revision UNIQUE (device_id, revision)');
    expect(sql).toContain('CREATE TABLE tuning_mqtt_outbox');
    expect(sql).toContain('DROP TABLE IF EXISTS tuning_mqtt_outbox');
    expect(sql).toContain('ON DELETE CASCADE');
  });

  it('contains only upgrade deltas in hardening and restores the original cascade FKs on rollback', async () => {
    const queryRunner = runner();
    const hardening = new HardenTuningShadow1720656000008();
    await hardening.up(queryRunner as QueryRunner);
    await hardening.down(queryRunner as QueryRunner);
    const sql = queryRunner.query.mock.calls.map(([statement]) => statement).join('\n');

    expect(sql).toContain('ADD COLUMN IF NOT EXISTS retained_clear_pending');
    expect(sql).toContain('uq_device_tuning_configs_device_command');
    expect(sql).toContain('uq_device_tuning_configs_device_revision');
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).toContain('ON DELETE CASCADE');
  });
});
