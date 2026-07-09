import { CurveCheckpoint } from './curve-checkpoint.entity';
import { GrowthProfile } from './growth-profile.entity';
import { CropBatch } from './crop-batch.entity';

describe('CurveCheckpoint Entity', () => {
  it('should create a CurveCheckpoint instance with profile relation', () => {
    const checkpoint = new CurveCheckpoint();
    checkpoint.id = '1';
    checkpoint.profileId = 'dry-season-opt';
    checkpoint.batchId = null;
    checkpoint.metricType = 'TEMPERATURE';
    checkpoint.cropDay = 5;
    checkpoint.targetValue = 28.5;

    const profile = new GrowthProfile();
    profile.id = 'dry-season-opt';
    checkpoint.profile = profile;
    checkpoint.batch = null;

    expect(checkpoint).toBeDefined();
    expect(checkpoint.id).toBe('1');
    expect(checkpoint.profileId).toBe('dry-season-opt');
    expect(checkpoint.batchId).toBeNull();
    expect(checkpoint.metricType).toBe('TEMPERATURE');
    expect(checkpoint.cropDay).toBe(5);
    expect(checkpoint.targetValue).toBe(28.5);
    expect(checkpoint.profile).toBeInstanceOf(GrowthProfile);
    expect(checkpoint.batch).toBeNull();
  });

  it('should create a CurveCheckpoint instance with batch relation', () => {
    const checkpoint = new CurveCheckpoint();
    checkpoint.id = '2';
    checkpoint.profileId = null;
    checkpoint.batchId = 'batch-123';
    checkpoint.metricType = 'HUMIDITY';
    checkpoint.cropDay = 10;
    checkpoint.targetValue = 85.0;

    const batch = new CropBatch();
    batch.id = 'batch-123';
    checkpoint.batch = batch;
    checkpoint.profile = null;

    expect(checkpoint).toBeDefined();
    expect(checkpoint.id).toBe('2');
    expect(checkpoint.profileId).toBeNull();
    expect(checkpoint.batchId).toBe('batch-123');
    expect(checkpoint.metricType).toBe('HUMIDITY');
    expect(checkpoint.cropDay).toBe(10);
    expect(checkpoint.targetValue).toBe(85.0);
    expect(checkpoint.batch).toBeInstanceOf(CropBatch);
    expect(checkpoint.profile).toBeNull();
  });
});
