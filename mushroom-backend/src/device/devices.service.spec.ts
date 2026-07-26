import { DevicesService } from './devices.service';

describe('DevicesService', () => {
  const repository = { query: jest.fn() };
  let service: DevicesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DevicesService(repository as never);
  });

  it('uses a parameterized existence-only query for an owned device', async () => {
    repository.query.mockResolvedValue([{ '?column?': 1 }]);

    await expect(
      service.isDeviceOwnedByUser('device-1', 'user-1'),
    ).resolves.toBe(true);

    expect(repository.query).toHaveBeenCalledWith(
      'SELECT 1 FROM devices WHERE device_id = $1 AND owner_user_id = $2',
      ['device-1', 'user-1'],
    );
  });

  it('returns false for an unknown device or a device owned by someone else', async () => {
    repository.query.mockResolvedValue([]);

    await expect(
      service.isDeviceOwnedByUser('device-1', 'different-user'),
    ).resolves.toBe(false);
  });
});
