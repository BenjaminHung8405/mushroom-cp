import { Client } from 'pg';
import { QueryRunner } from 'typeorm';
import { CreateDeviceTuningConfigurations1720656000006 } from './1720656000006-create-device-tuning-configurations';
import { CreateTuningAuditLogs1720656000007 } from './1720656000007-create-tuning-audit-logs';
import { HardenTuningShadow1720656000008 } from './1720656000008-harden-tuning-shadow';
import { CreateTuningMqttOutbox1720656000009 } from './1720656000009-create-tuning-mqtt-outbox';
import { AddReportedTuningShadow1720656000010 } from './1720656000010-add-reported-tuning-shadow';

/**
 * Real PostgreSQL integration test for Track-F migrations. This is a release
 * gate: TUNING_MIGRATION_DATABASE_URL must be supplied by the dedicated CI job.
 */

const TEST_DB = 'tuning_migration_it';

function connectionUrl(database: string): string {
  const rawUrl = process.env.TUNING_MIGRATION_DATABASE_URL;
  if (!rawUrl) {
    throw new Error('[tuning-migration-it] TUNING_MIGRATION_DATABASE_URL is required.');
  }
  if (database !== TEST_DB) {
    const url = new URL(rawUrl);
    url.pathname = `/${database}`;
    return url.toString();
  }
  return rawUrl;
}

async function ensureTestDatabaseAvailable(): Promise<void> {
  const adminClient = new Client({ connectionString: connectionUrl('postgres') });
  try {
    await adminClient.connect();
  } catch (error: unknown) {
    throw new Error(`[tuning-migration-it] PostgreSQL is unreachable: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  try {
    const existing = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
    if (existing.rowCount === 0) {
      await adminClient.query(`CREATE DATABASE ${TEST_DB}`);
    }
  } finally {
    await adminClient.end();
  }
}

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: connectionUrl(TEST_DB) });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function makeQueryRunner(client: Client): QueryRunner {
  return {
    async query(statement: string, parameters?: unknown[]) {
      const result = await client.query(statement, parameters as never);
      return result.rows;
    },
  } as unknown as QueryRunner;
}

async function resetPublicSchema(client: Client): Promise<void> {
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
}

async function seedDevicesTable(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE devices (
      device_id VARCHAR(50) PRIMARY KEY,
      house_id VARCHAR(50) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);
  await client.query('INSERT INTO devices(device_id, house_id) VALUES ($1, $2)', ['device-1', 'house-1']);
  await client.query('INSERT INTO devices(device_id, house_id) VALUES ($1, $2)', ['device-2', 'house-2']);
}

async function tableExists(client: Client, name: string): Promise<boolean> {
  const result = await client.query('SELECT to_regclass($1) AS relation', [`public.${name}`]);
  return result.rows[0].relation !== null;
}

async function constraintExists(client: Client, name: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM pg_constraint WHERE conname = $1', [name]);
  return result.rowCount === 1;
}

async function indexExists(client: Client, name: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM pg_indexes WHERE indexname = $1', [name]);
  return result.rowCount === 1;
}

async function fkOnDelete(client: Client, constraint: string): Promise<string | null> {
  const result = await client.query(
    `SELECT confdeltype FROM pg_constraint WHERE conname = $1`,
    [constraint],
  );
  return result.rowCount === 1 ? (result.rows[0].confdeltype as string) : null;
}

const migrations = () => [
  new CreateDeviceTuningConfigurations1720656000006(),
  new CreateTuningAuditLogs1720656000007(),
  new HardenTuningShadow1720656000008(),
  new CreateTuningMqttOutbox1720656000009(),
  new AddReportedTuningShadow1720656000010(),
];

beforeAll(async () => {
  await ensureTestDatabaseAvailable();
}, 30_000);

describe('tuning shadow migrations — clean install and rollback', () => {
  it('creates every Track-F object on up() and rolls back without drift on down()', async () => {
    await withClient(async (client) => {
      await resetPublicSchema(client);
      await seedDevicesTable(client);
      const runner = makeQueryRunner(client);
      const chain = migrations();
      for (const migration of chain) await migration.up(runner);

      expect(await tableExists(client, 'device_tuning_configurations')).toBe(true);
      expect(await tableExists(client, 'tuning_audit_logs')).toBe(true);
      expect(await tableExists(client, 'tuning_mqtt_outbox')).toBe(true);
      expect(await constraintExists(client, 'uq_device_tuning_configs_device_command')).toBe(true);
      expect(await constraintExists(client, 'uq_device_tuning_configs_device_revision')).toBe(true);
      expect(await indexExists(client, 'idx_device_tuning_configs_device_revision')).toBe(true);
      expect(await indexExists(client, 'idx_tuning_mqtt_outbox_device_due')).toBe(true);
      expect(await fkOnDelete(client, 'fk_tuning_audit_configuration')).toBe('r');
      expect(await fkOnDelete(client, 'fk_tuning_audit_device')).toBe('r');

      for (const migration of [...chain].reverse()) await migration.down(runner);
      expect(await tableExists(client, 'device_tuning_configurations')).toBe(false);
      expect(await tableExists(client, 'tuning_audit_logs')).toBe(false);
      expect(await tableExists(client, 'tuning_mqtt_outbox')).toBe(false);
    });
  }, 60_000);
});

describe('tuning shadow migrations — upgrade from historical data', () => {
  it('aborts before DDL when duplicates would break UNIQUE constraints', async () => {
    await withClient(async (client) => {
      await resetPublicSchema(client);
      await seedDevicesTable(client);
      const runner = makeQueryRunner(client);

      const legacy = [
        new CreateDeviceTuningConfigurations1720656000006(),
        new CreateTuningAuditLogs1720656000007(),
      ];
      for (const migration of legacy) await migration.up(runner);

      const snapshot = { lamp_gain_scale: 1, mist_gain_scale: 1, mist_on_threshold: 0.25, mist_off_threshold: 0.15 };
      await client.query(
        `INSERT INTO device_tuning_configurations(id, device_id, command_id, revision, status, config)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb), ($7, $2, $3, $8, $5, $6::jsonb)`,
        [
          '11111111-1111-1111-1111-111111111111', 'device-1', '22222222-2222-2222-2222-222222222222', 1, 'PENDING', JSON.stringify(snapshot),
          '33333333-3333-3333-3333-333333333333', 2,
        ],
      );

      const hardening = new HardenTuningShadow1720656000008();
      await expect(hardening.up(runner)).rejects.toThrow(/duplicate/);
      expect(await constraintExists(client, 'uq_device_tuning_configs_device_command')).toBe(false);
      expect(await constraintExists(client, 'uq_device_tuning_configs_device_revision')).toBe(false);
    });
  }, 60_000);

  it('completes hardening plus reported shadow when historical data is clean', async () => {
    await withClient(async (client) => {
      await resetPublicSchema(client);
      await seedDevicesTable(client);
      const runner = makeQueryRunner(client);

      const legacy = [
        new CreateDeviceTuningConfigurations1720656000006(),
        new CreateTuningAuditLogs1720656000007(),
      ];
      for (const migration of legacy) await migration.up(runner);

      await client.query('CREATE TABLE tuning_audit_extensions (id UUID PRIMARY KEY)');
      await client.query('ALTER TABLE tuning_audit_logs ADD COLUMN extension_id UUID');
      await client.query(`
        ALTER TABLE tuning_audit_logs
          ADD CONSTRAINT fk_tuning_audit_unrelated_extension
          FOREIGN KEY (extension_id) REFERENCES tuning_audit_extensions(id) ON DELETE CASCADE
      `);

      const snapshot = { lamp_gain_scale: 1, mist_gain_scale: 1, mist_on_threshold: 0.25, mist_off_threshold: 0.15 };
      await client.query(
        `INSERT INTO device_tuning_configurations(id, device_id, command_id, revision, status, config)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        ['44444444-4444-4444-4444-444444444444', 'device-1', '55555555-5555-5555-5555-555555555555', 1, 'PENDING', JSON.stringify(snapshot)],
      );

      await new HardenTuningShadow1720656000008().up(runner);
      await new CreateTuningMqttOutbox1720656000009().up(runner);
      await new AddReportedTuningShadow1720656000010().up(runner);

      expect(await constraintExists(client, 'uq_device_tuning_configs_device_command')).toBe(true);
      expect(await indexExists(client, 'idx_device_tuning_configs_device_revision')).toBe(true);
      expect(await fkOnDelete(client, 'fk_tuning_audit_device')).toBe('r');
      expect(await constraintExists(client, 'fk_tuning_audit_unrelated_extension')).toBe(true);
      expect(await fkOnDelete(client, 'fk_tuning_audit_unrelated_extension')).toBe('c');

      await new AddReportedTuningShadow1720656000010().down(runner);
      await new CreateTuningMqttOutbox1720656000009().down(runner);
      await new HardenTuningShadow1720656000008().down(runner);

      expect(await tableExists(client, 'tuning_mqtt_outbox')).toBe(false);
      expect(await fkOnDelete(client, 'fk_tuning_audit_device')).toBe('c');
    });
  }, 60_000);
});
