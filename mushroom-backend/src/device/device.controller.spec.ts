/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { DeviceController } from './device.controller';
import { MqttService } from '../mqtt/mqtt.service';
import { DeviceRegistryService } from './device-registry.service';

describe('DeviceController', () => {
  let controller: DeviceController;
  let mqttService: jest.Mocked<MqttService>;
  let deviceRegistryService: jest.Mocked<DeviceRegistryService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeviceController],
      providers: [
        {
          provide: MqttService,
          useFactory: () => ({
            getAllDeviceStatuses: jest.fn(),
            dispatchSetpoint: jest.fn(),
          }),
        },
        {
          provide: DeviceRegistryService,
          useFactory: () => ({
            get: jest.fn(),
            refreshOne: jest.fn(),
          }),
        },
      ],
    }).compile();

    controller = module.get<DeviceController>(DeviceController);
    mqttService = module.get(MqttService);
    deviceRegistryService = module.get(DeviceRegistryService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getDevice', () => {
    it('should return device mapping when found in cache', async () => {
      deviceRegistryService.get.mockReturnValue({
        deviceId: 'esp32_01',
        houseId: 'house_01',
        enabled: true,
        displayName: 'Lab ESP32',
        mqttUsername: 'esp32_01',
        lastSeenAt: null,
      });

      const result = await controller.getDevice({ id: 'esp32_01' });
      expect(result).toEqual({
        deviceId: 'esp32_01',
        houseId: 'house_01',
        displayName: 'Lab ESP32',
      });
      expect(deviceRegistryService.refreshOne).not.toHaveBeenCalled();
    });

    it('should fallback to refreshOne when not cached', async () => {
      deviceRegistryService.get.mockReturnValue(undefined);
      deviceRegistryService.refreshOne.mockResolvedValue({
        deviceId: 'esp32_02',
        houseId: 'house_02',
        enabled: true,
        displayName: null,
        mqttUsername: 'esp32_02',
        lastSeenAt: null,
      });

      const result = await controller.getDevice({ id: 'esp32_02' });
      expect(result.houseId).toBe('house_02');
      expect(deviceRegistryService.refreshOne).toHaveBeenCalledWith('esp32_02');
    });

    it('should throw NotFoundException when device not found anywhere', async () => {
      deviceRegistryService.get.mockReturnValue(undefined);
      deviceRegistryService.refreshOne.mockResolvedValue(null);

      await expect(
        controller.getDevice({ id: 'unknown_device' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('publishSetpoint', () => {
    it('should reject when required fields are missing', async () => {
      const result = await controller.publishSetpoint(
        { id: 'esp32_01' },
        { humidityMeasured: 50 },
      );
      expect(result.message).toContain('Rejected');
    });

    it('should dispatch setpoint via MQTT when valid', async () => {
      const result = await controller.publishSetpoint(
        { id: 'esp32_01' },
        { temperatureSetpoint: 30, humiditySetpoint: 80 },
      );
      expect(result.message).toContain('dispatched');
      expect(mqttService.dispatchSetpoint).toHaveBeenCalledWith('esp32_01', {
        temperatureSetpoint: 30,
        humiditySetpoint: 80,
        control_mode: 'fuzzy_tpc',
        setpoint_ttl_sec: 120,
      });
    });
  });
});
