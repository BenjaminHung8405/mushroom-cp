import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

interface PostgresPoolLike {
  on?: (event: 'error', listener: (error: unknown) => void) => void;
  off?: (event: 'error', listener: (error: unknown) => void) => void;
  removeListener?: (event: 'error', listener: (error: unknown) => void) => void;
}

interface TypeOrmPostgresDriverLike {
  master?: PostgresPoolLike;
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private postgresPool: PostgresPoolLike | null = null;

  private readonly handlePoolError = (error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    // pg emits pool errors for idle clients independently of a query promise.
    // Keep the process alive; the pool discards the failed client and retries
    // on the next query instead of allowing an uncaught EventEmitter error to
    // terminate the Nest process.
    this.logger.error(
      `PostgreSQL pool error; keeping API process alive: ${message}`,
    );
  };

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    this.attachPostgresPoolErrorHandler();
    this.logger.log('Testing database connection using TypeORM DataSource...');
    try {
      await this.dataSource.query('SELECT NOW()');
      this.logger.log('✅ Database connection test succeeded.');
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`❌ Database connection test failed: ${errorMessage}`);
    }
  }

  onModuleDestroy(): void {
    const pool = this.postgresPool;
    if (!pool) return;

    if (pool.off) {
      pool.off('error', this.handlePoolError);
    } else {
      pool.removeListener?.('error', this.handlePoolError);
    }
    this.postgresPool = null;
  }

  private attachPostgresPoolErrorHandler(): void {
    const driver = this.dataSource
      .driver as unknown as TypeOrmPostgresDriverLike;
    const pool = driver.master;
    if (!pool?.on) {
      this.logger.warn('PostgreSQL pool error handler could not be attached.');
      return;
    }

    pool.on('error', this.handlePoolError);
    this.postgresPool = pool;
  }

  /** Execute related writes atomically; callers receive a query adapter scoped to one transaction. */
  async transaction<T>(
    work: (
      query: <R = unknown>(
        text: string,
        params?: unknown[],
      ) => Promise<{ rows: R[] }>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const query = async <R = unknown>(
        text: string,
        params?: unknown[],
      ): Promise<{ rows: R[] }> => {
        const result = await manager.query(text, params);
        return { rows: Array.isArray(result) ? (result as R[]) : [] };
      };
      return work(query);
    });
  }

  /**
   * Helper to execute queries on the DataSource (Adapter Pattern)
   */
  async query<T = any>(text: string, params?: any[]): Promise<{ rows: T[] }> {
    const start = Date.now();
    try {
      const res = (await this.dataSource.query(text, params)) as unknown;
      const duration = Date.now() - start;
      this.logger.debug(`Executed query | Duration: ${duration}ms`);
      const rows = Array.isArray(res) ? (res as T[]) : [];
      return { rows };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Query failed: ${text.slice(0, 100)}... | Error: ${errorMessage}`,
      );
      throw error;
    }
  }
}
