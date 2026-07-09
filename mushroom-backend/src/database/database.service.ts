import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseService implements OnModuleInit {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
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
