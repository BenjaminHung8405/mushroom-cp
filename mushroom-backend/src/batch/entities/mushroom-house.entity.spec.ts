import { MushroomHouse } from './mushroom-house.entity';

describe('MushroomHouse Entity', () => {
  it('should create a MushroomHouse instance', () => {
    const house = new MushroomHouse();
    house.id = 'house-123';
    house.name = 'House A';
    house.areaMeters = '4x6';
    house.pillarCount = 35;
    house.createdAt = new Date();

    expect(house).toBeDefined();
    expect(house.id).toBe('house-123');
    expect(house.name).toBe('House A');
    expect(house.areaMeters).toBe('4x6');
    expect(house.pillarCount).toBe(35);
    expect(house.createdAt).toBeInstanceOf(Date);
  });
});
