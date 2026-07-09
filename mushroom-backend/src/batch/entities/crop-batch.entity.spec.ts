import { CropBatch } from './crop-batch.entity';
import { MushroomHouse } from './mushroom-house.entity';

describe('CropBatch Entity', () => {
  it('should create a CropBatch instance', () => {
    const batch = new CropBatch();
    batch.id = 'batch-123';
    batch.houseId = 'house-123';
    
    const house = new MushroomHouse();
    house.id = 'house-123';
    house.name = 'House A';
    batch.house = house;

    batch.profileName = 'Test Profile';
    batch.status = 'ACTIVE';
    batch.startDate = new Date();
    batch.totalCropDays = 30;
    batch.spawnRunningEndDay = 8;
    batch.tempOptimalMin = 28.0;
    batch.tempOptimalMax = 35.0;
    batch.humidityOptimalMin = 70.0;
    batch.humidityOptimalMax = 90.0;
    batch.thermalShockProtection = true;
    batch.thermalShockStart = '11:00:00';
    batch.thermalShockEnd = '13:30:00';
    batch.updatedAt = new Date();

    expect(batch).toBeDefined();
    expect(batch.id).toBe('batch-123');
    expect(batch.houseId).toBe('house-123');
    expect(batch.house).toBeInstanceOf(MushroomHouse);
    expect(batch.profileName).toBe('Test Profile');
    expect(batch.status).toBe('ACTIVE');
    expect(batch.totalCropDays).toBe(30);
    expect(batch.spawnRunningEndDay).toBe(8);
    expect(batch.tempOptimalMin).toBe(28.0);
    expect(batch.tempOptimalMax).toBe(35.0);
    expect(batch.humidityOptimalMin).toBe(70.0);
    expect(batch.humidityOptimalMax).toBe(90.0);
    expect(batch.thermalShockProtection).toBe(true);
    expect(batch.thermalShockStart).toBe('11:00:00');
    expect(batch.thermalShockEnd).toBe('13:30:00');
    expect(batch.updatedAt).toBeInstanceOf(Date);
  });
});
