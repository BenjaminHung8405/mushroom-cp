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
          let val = trimmed.slice(firstEqual + 1).trim();

          // Kiểm tra xem giá trị có được bao bọc bởi dấu nháy hay không
          const isDoubleQuoted = val.startsWith('"');
          const isSingleQuoted = val.startsWith("'");

          if (isDoubleQuoted || isSingleQuoted) {
            const quoteChar = isDoubleQuoted ? '"' : "'";
            // Tìm dấu nháy đóng bắt đầu từ vị trí thứ 2
            const closingQuoteIndex = val.indexOf(quoteChar, 1);
            if (closingQuoteIndex !== -1) {
              val = val.slice(1, closingQuoteIndex);
            } else {
              val = val.slice(1); // Fallback nếu thiếu nháy đóng
            }
          } else {
            // Trường hợp không có dấu nháy, chỉ coi là comment nếu có khoảng trắng đứng trước '#'
            const commentIndex = val.search(/\s#/);
            if (commentIndex !== -1) {
              val = val.slice(0, commentIndex).trim();
            }
          }
          const cleanedVal = val;
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
const commonOptions = {
  type: 'postgres' as const,
  synchronize: false,
  entities: [path.join(__dirname, '/../**/*.entity{.ts,.js}')],
  migrations: [path.join(__dirname, '/migrations/*{.ts,.js}')],
  extra: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },
  ...(process.env.NODE_ENV === 'test' ? { retryAttempts: 0 } : {}),
};

let config: DataSourceOptions & { retryAttempts?: number };

if (process.env.DATABASE_URL) {
  config = {
    ...commonOptions,
    url: process.env.DATABASE_URL,
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
    ...commonOptions,
    host: process.env.POSTGRES_HOST,
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
  };
}

export const typeOrmConfig = config;
const dataSource = new DataSource(typeOrmConfig);
export default dataSource;
