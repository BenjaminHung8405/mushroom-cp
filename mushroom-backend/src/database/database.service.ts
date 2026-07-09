import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool, QueryResult, QueryResultRow } from 'pg';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;

  onModuleInit() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      this.logger.error('DATABASE_URL environment variable is missing.');
      throw new Error('DATABASE_URL is not defined');
    }

    this.logger.log('Initializing PostgreSQL Connection Pool...');
    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test the connection immediately
    this.pool.query('SELECT NOW()', (err) => {
      if (err) {
        this.logger.error(`PostgreSQL connection failed: ${err.message}`);
      } else {
        this.logger.log(
          '✅ PostgreSQL connection pool initialized successfully.',
        );
      }
    });
  }

  async onModuleDestroy() {
    this.logger.log('Closing PostgreSQL Connection Pool...');
    await this.pool.end();
    this.logger.log('PostgreSQL Connection Pool closed.');
  }

  /**
   * Helper to execute queries on the pool
   */
  async query<T extends QueryResultRow = any>(
    text: string,
    params?: any[],
  ): Promise<QueryResult<T>> {
    const start = Date.now();
    try {
      const res = await this.pool.query<T>(text, params);
      const duration = Date.now() - start;
      this.logger.debug(`Executed query | Duration: ${duration}ms`);
      return res;
    } catch (error) {
      this.logger.error(
        `Query failed: ${text.slice(0, 100)}... | Error: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Get direct access to the pool if needed (e.g. for transactions)
   */
  getPool(): Pool {
    return this.pool;
  }
}
