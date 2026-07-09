import { LightScheduleBlock } from './light-schedule-block.entity';
import { GrowthProfile } from './growth-profile.entity';
import { CropBatch } from './crop-batch.entity';

describe('LightScheduleBlock Entity', () => {
  it('should create a LightScheduleBlock instance with profile relation', () => {
    const block = new LightScheduleBlock();
    block.id = '1';
    block.profileId = 'dry-season-opt';
    block.batchId = null;
    block.startDay = 1;
    block.endDay = 10;
    block.status = 'ON';

    const profile = new GrowthProfile();
    profile.id = 'dry-season-opt';
    block.profile = profile;
    block.batch = null;

    expect(block).toBeDefined();
    expect(block.id).toBe('1');
    expect(block.profileId).toBe('dry-season-opt');
    expect(block.batchId).toBeNull();
    expect(block.startDay).toBe(1);
    expect(block.endDay).toBe(10);
    expect(block.status).toBe('ON');
    expect(block.profile).toBeInstanceOf(GrowthProfile);
    expect(block.batch).toBeNull();
  });

  it('should create a LightScheduleBlock instance with batch relation', () => {
    const block = new LightScheduleBlock();
    block.id = '2';
    block.profileId = null;
    block.batchId = 'batch-123';
    block.startDay = 11;
    block.endDay = 20;
    block.status = 'OFF';

    const batch = new CropBatch();
    batch.id = 'batch-123';
    block.batch = batch;
    block.profile = null;

    expect(block).toBeDefined();
    expect(block.id).toBe('2');
    expect(block.profileId).toBeNull();
    expect(block.batchId).toBe('batch-123');
    expect(block.startDay).toBe(11);
    expect(block.endDay).toBe(20);
    expect(block.status).toBe('OFF');
    expect(block.batch).toBeInstanceOf(CropBatch);
    expect(block.profile).toBeNull();
  });
});
