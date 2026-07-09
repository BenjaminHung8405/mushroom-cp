import { DataSource, DataSourceOptions } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';

// 1. Chỉ thực hiện parse file .env và đưa vào process.env nếu file tồn tại
const envPaths = [
  path.join(__dirname, '../../.env'), // mushroom-backend/.env
  path.join(__dirname, '../../../.env'), // workspace root/.env
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const firstEqual = trimmed.indexOf('=');
        if (firstEqual !== -1) {
          const key = trimmed.slice(0, firstEqual).trim();
          const val = trimmed.slice(firstEqual + 1).trim();
          const cleanedVal = val.replace(/^['"]|['"]$/g, '');
          // Không ghi đè nếu biến đã có sẵn trong môi trường hệ thống
          if (process.env[key] === undefined) {
            process.env[key] = cleanedVal;
          }
        }
      }
    }
    break; // Ưu tiên file .env gần nhất
  }
}

// 2. Chuẩn bị cấu hình TypeORM dựa trên biến môi trường (Ưu tiên DATABASE_URL trực tiếp)
let config: DataSourceOptions;

if (process.env.DATABASE_URL) {
  config = {
    type: 'postgres',
    url: process.env.DATABASE_URL,
    synchronize: false,
    entities: [path.join(__dirname, '/../**/*.entity{.ts,.js}')],
    migrations: [path.join(__dirname, '/migrations/*{.ts,.js}')],
    extra: {
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    },
  };
} else {
  // 3. Nếu không có DATABASE_URL, kiểm tra bắt buộc và ném lỗi cụ thể nếu thiếu thông tin cấu hình
  const requiredEnv = [
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_HOST',
    'POSTGRES_PORT',
    'POSTGRES_DB',
  ];
  const missingEnv = requiredEnv.filter((key) => !process.env[key]);

  if (missingEnv.length > 0 && process.env.NODE_ENV !== 'test') {
    throw new Error(
      `Database connection configuration error: Missing environment variables: ${missingEnv.join(', ')}. Please provide DATABASE_URL or full POSTGRES_* credentials.`,
    );
  }

  config = {
    type: 'postgres',
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    synchronize: false,
    entities: [path.join(__dirname, '/../**/*.entity{.ts,.js}')],
    migrations: [path.join(__dirname, '/migrations/*{.ts,.js}')],
    extra: {
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    },
  };
}

export const typeOrmConfig = config;
const dataSource = new DataSource(typeOrmConfig);
export default dataSource;
