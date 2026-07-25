import { BadRequestException } from '@nestjs/common';
import { TuningController } from './tuning.controller';
import { TuningConfigurationService } from '../services/tuning-configuration.service';
import { TuningPrincipal } from '../guards/tuning-principal.guard';

describe('TuningController', () => {
  const service = {
    getHistoryForPrincipal: jest.fn(),
  } as unknown as TuningConfigurationService;
  const controller = new TuningController(service);

  const mockPrincipal: TuningPrincipal = {
    subject: 'user-1',
    isAdmin: true,
    allowedHouseIds: ['house-1'],
  };
  const mockRequest = { tuningPrincipal: mockPrincipal } as any;

  beforeEach(() => jest.clearAllMocks());

  it('rejects invalid pagination values with BadRequestException', () => {
    // ?limit=abc
    expect(() => controller.history('device-1', 'abc', '10', mockRequest)).toThrow(BadRequestException);
    // ?limit=0
    expect(() => controller.history('device-1', '0', '10', mockRequest)).toThrow(BadRequestException);
    // ?offset=-1
    expect(() => controller.history('device-1', '10', '-1', mockRequest)).toThrow(BadRequestException);
    // ?limit=101
    expect(() => controller.history('device-1', '101', '10', mockRequest)).toThrow(BadRequestException);
    // ?limit=9007199254740993 (> MAX_SAFE_INTEGER)
    expect(() => controller.history('device-1', '9007199254740993', '10', mockRequest)).toThrow(BadRequestException);
  });

  it('allows valid pagination values and passes them to service', () => {
    const getHistory = service.getHistoryForPrincipal as jest.Mock;
    getHistory.mockReturnValue({ items: [], total: 0, limit: 10, offset: 0 });

    // ?limit=1, ?offset=0
    expect(controller.history('device-1', '1', '0', mockRequest)).toBeDefined();
    expect(getHistory).toHaveBeenLastCalledWith(mockPrincipal, 'device-1', 1, 0);

    // ?limit=100, ?offset=50
    expect(controller.history('device-1', '100', '50', mockRequest)).toBeDefined();
    expect(getHistory).toHaveBeenLastCalledWith(mockPrincipal, 'device-1', 100, 50);

    // absent (undefined) limits
    expect(controller.history('device-1', undefined, undefined, mockRequest)).toBeDefined();
    expect(getHistory).toHaveBeenLastCalledWith(mockPrincipal, 'device-1', undefined, undefined);
  });
});
