import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DatabaseService } from './database.service';
import { typeOrmConfig } from './typeorm.config';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => typeOrmConfig,
    }),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService, TypeOrmModule],
})
export class DatabaseModule {}
