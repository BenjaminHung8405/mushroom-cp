import { TuningCommandController } from './tuning-command.controller';
import { TuningConfigurationService } from '../services/tuning-configuration.service';
import type { JwtAuthenticatedRequest } from '../guards/jwt-auth.guard';
import { CreateTuningConfigurationDto } from '../dtos/create-tuning-configuration.dto';

describe('TuningCommandController', () => {
  const createPendingCommand = jest.fn();
  const getLatestByDeviceId = jest.fn();
  const service = {
    createPendingCommand,
    getLatestByDeviceId,
  } as unknown as TuningConfigurationService;
  const controller = new TuningCommandController(service);

  const commandId = '12345678-1234-1234-1234-1234567890ab';
  const config = {
    lamp_gain_scale: 1,
    mist_gain_scale: 1,
    mist_on_threshold: 0.25,
    mist_off_threshold: 0.15,
  };
  const dto: CreateTuningConfigurationDto = { commandId, config };

  beforeEach(() => {
    jest.clearAllMocks();
    createPendingCommand.mockResolvedValue({ commandId, status: 'PENDING' });
    getLatestByDeviceId.mockResolvedValue(null);
  });

  it('delegates durable command creation with the verified actor email', async () => {
    const request = {
      user: { sub: 'user-1', email: 'operator@example.com' },
    } as unknown as JwtAuthenticatedRequest;

    const result = await controller.createTuningConfiguration(
      'device-1',
      dto,
      request,
    );

    expect(createPendingCommand).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'operator@example.com' }),
      'device-1',
      config,
      commandId,
    );
    expect(result).toEqual({ commandId, status: 'PENDING' });
  });

  it('rejects the request if the verified JWT does not contain an email claim', async () => {
    const request = {
      user: { sub: 'user-1' },
    } as unknown as JwtAuthenticatedRequest;

    await expect(
      controller.createTuningConfiguration('device-1', dto, request),
    ).rejects.toThrow('JWT email is required for tuning commands.');
    expect(createPendingCommand).not.toHaveBeenCalled();
  });

  it('returns the latest durable configuration state for the guarded device', async () => {
    const latestConfiguration = {
      commandId,
      deviceId: 'device-1',
      revision: 2,
      status: 'IN_SYNC',
      config,
    };
    getLatestByDeviceId.mockResolvedValue(latestConfiguration);

    await expect(
      controller.getLatestTuningConfiguration('device-1'),
    ).resolves.toBe(latestConfiguration);
    expect(getLatestByDeviceId).toHaveBeenCalledTimes(1);
    expect(getLatestByDeviceId).toHaveBeenCalledWith('device-1');
  });

  it('preserves a missing durable configuration as null', async () => {
    await expect(
      controller.getLatestTuningConfiguration('device-without-configuration'),
    ).resolves.toBeNull();
    expect(getLatestByDeviceId).toHaveBeenCalledWith(
      'device-without-configuration',
    );
  });
});
