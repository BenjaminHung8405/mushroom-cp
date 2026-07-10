import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BatchController } from './controllers/batch.controller';
import { BatchService } from './services/batch.service';
import { CropBatch } from './entities/crop-batch.entity';
import { MushroomHouse } from './entities/mushroom-house.entity';
import { CurveCheckpoint } from './entities/curve-checkpoint.entity';
import { LightScheduleBlock } from './entities/light-schedule-block.entity';
import { GrowthProfile } from './entities/growth-profile.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CropBatch,
      MushroomHouse,
      CurveCheckpoint,
      LightScheduleBlock,
      GrowthProfile,
    ]),
  ],
  controllers: [BatchController],
  providers: [BatchService],
  exports: [BatchService],
})
export class BatchModule {}
