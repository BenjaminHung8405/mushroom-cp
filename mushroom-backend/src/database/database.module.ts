import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseService } from './database.service';
import { TelemetryQueryService } from './telemetry-query.service';
import { typeOrmConfig } from './typeorm.config';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => typeOrmConfig,
    }),
  ],
  providers: [DatabaseService, TelemetryQueryService],
  exports: [DatabaseService, TelemetryQueryService, TypeOrmModule],
})
export class DatabaseModule {}
