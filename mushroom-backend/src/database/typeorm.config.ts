import { DataSource, DataSourceOptions } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

// Parse local/root .env if DATABASE_URL is not set in environment (e.g. CLI run)
if (!process.env.DATABASE_URL) {
  const envPaths = [
    path.join(__dirname, '../../.env'), // mushroom-backend/.env
    path.join(__dirname, '../../../.env'), // workspace root/.env
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const lines = content.split('\n');
      const parsedEnv: Record<string, string> = {};

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const firstEqual = trimmed.indexOf('=');
          if (firstEqual !== -1) {
            const key = trimmed.slice(0, firstEqual).trim();
            const val = trimmed.slice(firstEqual + 1).trim();
            // Remove single/double quotes
            const cleanedVal = val.replace(/^['"]|['"]$/g, '');
            parsedEnv[key] = cleanedVal;
          }
        }
      }

      // Reconstruct DATABASE_URL if individual credentials are provided
      const user =
        parsedEnv.POSTGRES_USER || process.env.POSTGRES_USER || 'admin';
      const password =
        parsedEnv.POSTGRES_PASSWORD ||
        process.env.POSTGRES_PASSWORD ||
        '123456';
      const host =
        parsedEnv.POSTGRES_HOST || process.env.POSTGRES_HOST || 'localhost';
      const port =
        parsedEnv.POSTGRES_PORT || process.env.POSTGRES_PORT || '5432';
      const db =
        parsedEnv.POSTGRES_DB || process.env.POSTGRES_DB || 'mushroom_iot_db';

      process.env.DATABASE_URL = `postgresql://${user}:${password}@${host}:${port}/${db}`;
      break;
    }
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL environment variable is missing.');
}

export const typeOrmConfig: DataSourceOptions = {
  type: 'postgres',
  url: databaseUrl,
  synchronize: false,
  entities: [path.join(__dirname, '/../**/*.entity{.ts,.js}')],
  migrations: [path.join(__dirname, '/migrations/*{.ts,.js}')],
  extra: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
};

const dataSource = new DataSource(typeOrmConfig);
export default dataSource;
