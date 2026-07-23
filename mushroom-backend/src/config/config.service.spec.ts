import { AppConfigService } from './config.service';

describe('AppConfigService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should construct successfully with a valid tenant', () => {
    process.env.IOT_TENANT = 'valid-tenant_123';
    const configService = new AppConfigService();
    expect(configService.getTenant()).toBe('valid-tenant_123');
  });

  it('should throw an error if IOT_TENANT is missing or empty', () => {
    delete process.env.IOT_TENANT;
    expect(() => new AppConfigService()).toThrow(
      'Configuration error: IOT_TENANT environment variable is required.',
    );

    process.env.IOT_TENANT = '   ';
    expect(() => new AppConfigService()).toThrow(
      'Configuration error: IOT_TENANT environment variable is required.',
    );
  });

  it('should throw an error if IOT_TENANT exceeds 50 characters', () => {
    process.env.IOT_TENANT = 'a'.repeat(51);
    expect(() => new AppConfigService()).toThrow(
      'Configuration error: IOT_TENANT is invalid.',
    );
  });

  it('should throw an error if IOT_TENANT contains forbidden characters like slash, plus, hash, or whitespace', () => {
    const invalidTenants = [
      'tenant/sub',
      'tenant+abc',
      'tenant#1',
      'tenant space',
      'tenant.dot',
      'tenant$',
    ];

    for (const invalid of invalidTenants) {
      process.env.IOT_TENANT = invalid;
      expect(() => new AppConfigService()).toThrow(
        'Configuration error: IOT_TENANT is invalid.',
      );
    }
  });
});
