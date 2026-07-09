import { Module, Global } from '@nestjs/common';
import { DatabaseService } from './database.service';
import { TelemetryQueryService } from './telemetry-query.service';

@Global()
@Module({
  providers: [DatabaseService, TelemetryQueryService],
  exports: [DatabaseService, TelemetryQueryService],
})
export class DatabaseModule {}
