import { GrowthProfile } from './growth-profile.entity';

describe('GrowthProfile Entity', () => {
  it('should create a GrowthProfile instance', () => {
    const profile = new GrowthProfile();
    profile.id = 'dry-season-opt';
    profile.name = 'Dry Season Optimization';
    profile.description = 'Optimal settings for dry season cultivation';
    profile.createdAt = new Date();
    profile.updatedAt = new Date();

    expect(profile).toBeDefined();
    expect(profile.id).toBe('dry-season-opt');
    expect(profile.name).toBe('Dry Season Optimization');
    expect(profile.description).toBe(
      'Optimal settings for dry season cultivation',
    );
    expect(profile.createdAt).toBeInstanceOf(Date);
    expect(profile.updatedAt).toBeInstanceOf(Date);
  });
});
