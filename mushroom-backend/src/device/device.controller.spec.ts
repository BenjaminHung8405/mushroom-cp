/* eslint-disable @typescript-eslint/unbound-method */

import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DeviceController, isBlackoutActive } from './device.controller';
import { MqttService } from '../mqtt/mqtt.service';
import { DeviceRegistryService } from './device-registry.service';
import { BatchService } from '../batch/services/batch.service';

describe('DeviceController', () => {
  let controller: DeviceController;
  let mqttService: jest.Mocked<MqttService>;
  let deviceRegistryService: jest.Mocked<DeviceRegistryService>;
  let batchService: jest.Mocked<BatchService>;

  describe('isBlackoutActive', () => {
    it.each([
      [0, true],
      [360, true],
      [361, false],
      [479, false],
      [480, true],
      [960, true],
      [961, false],
      [1079, false],
      [1080, true],
    ])('returns %s for minute %i', (minute, expected) => {
      expect(isBlackoutActive(minute)).toBe(expected);
    });
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DeviceController],
      providers: [
        {
          provide: MqttService,
          useFactory: () => ({
            getAllDeviceStatuses: jest.fn(),
            dispatchSetpoint: jest.fn(),
            dispatchActuatorOverride: jest.fn(),
          }),
        },
        {
          provide: DeviceRegistryService,
          useFactory: () => ({
            get: jest.fn(),
            refreshOne: jest.fn(),
          }),
        },
        {
          provide: BatchService,
          useFactory: () => ({
            getActiveBatchByHouseId: jest.fn(),
          }),
        },
      ],
    }).compile();

    controller = module.get<DeviceController>(DeviceController);
    mqttService = module.get(MqttService);
    deviceRegistryService = module.get(DeviceRegistryService);
    batchService = module.get(BatchService);
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
      expect(result.message).toContain('Đang đồng bộ setpoint');
      expect(mqttService.dispatchSetpoint).toHaveBeenCalledWith('esp32_01', {
        temperatureSetpoint: 30,
        humiditySetpoint: 80,
        setpoint_ttl_sec: 0,
      });
    });
  });

  describe('publishActuatorOverride', () => {
    const mockDevice = {
      deviceId: 'esp32_01',
      houseId: 'house_01',
      enabled: true,
      displayName: 'Lab ESP32',
      mqttUsername: 'esp32_01',
      lastSeenAt: null,
    };

    it('should throw NotFoundException when device does not exist', async () => {
      deviceRegistryService.get.mockReturnValue(undefined);
      deviceRegistryService.refreshOne.mockResolvedValue(null);

      await expect(
        controller.publishActuatorOverride(
          { id: 'unknown' },
          { actuator: 'fan', state: true },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should dispatch override command when valid', async () => {
      deviceRegistryService.get.mockReturnValue(mockDevice);

      const result = await controller.publishActuatorOverride(
        { id: 'esp32_01' },
        { actuator: 'fan', state: true },
      );

      expect(result.message).toContain('đã được gửi đi');
      expect(mqttService.dispatchActuatorOverride).toHaveBeenCalledWith(
        'esp32_01',
        'fan',
        true,
      );
    });

    it.each([
      ['mist', '08:00', '2026-07-14T08:00:00+07:00'],
      ['mist', '12:00', '2026-07-14T12:00:00+07:00'],
      ['mist', '18:00', '2026-07-14T18:00:00+07:00'],
      ['mist', '03:00', '2026-07-14T03:00:00+07:00'],
      ['heater_air', '08:00', '2026-07-14T08:00:00+07:00'],
      ['heater_air', '12:00', '2026-07-14T12:00:00+07:00'],
      ['heater_air', '18:00', '2026-07-14T18:00:00+07:00'],
      ['heater_air', '03:00', '2026-07-14T03:00:00+07:00'],
    ] as const)(
      'should block %s ON at %s during a blackout window',
      async (actuator, _label, isoTime) => {
        deviceRegistryService.get.mockReturnValue(mockDevice);
        jest.useFakeTimers().setSystemTime(new Date(isoTime));

        try {
          await expect(
            controller.publishActuatorOverride(
              { id: 'esp32_01' },
              { actuator, state: true },
            ),
          ).rejects.toThrow(BadRequestException);
        } finally {
          jest.useRealTimers();
        }
      },
    );

    it.each([
      ['mist', '06:01', '2026-07-14T06:01:00+07:00'],
      ['mist', '07:30', '2026-07-14T07:30:00+07:00'],
      ['mist', '16:01', '2026-07-14T16:01:00+07:00'],
      ['mist', '17:30', '2026-07-14T17:30:00+07:00'],
      ['heater_air', '06:01', '2026-07-14T06:01:00+07:00'],
      ['heater_air', '07:30', '2026-07-14T07:30:00+07:00'],
      ['heater_air', '16:01', '2026-07-14T16:01:00+07:00'],
      ['heater_air', '17:30', '2026-07-14T17:30:00+07:00'],
    ] as const)(
      'should allow %s ON at %s in a safe zone',
      async (actuator, _label, isoTime) => {
        deviceRegistryService.get.mockReturnValue(mockDevice);
        jest.useFakeTimers().setSystemTime(new Date(isoTime));

        try {
          const result = await controller.publishActuatorOverride(
            { id: 'esp32_01' },
            { actuator, state: true },
          );

          expect(result.message).toContain('đã được gửi đi');
          expect(mqttService.dispatchActuatorOverride).toHaveBeenCalledWith(
            'esp32_01',
            actuator,
            true,
          );
        } finally {
          jest.useRealTimers();
        }
      },
    );

    it('should block heater_air ON when cropDay > 8', async () => {
      deviceRegistryService.get.mockReturnValue(mockDevice);

      // Batch started 9 days ago
      const startDate = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
      batchService.getActiveBatchByHouseId.mockResolvedValue({
        id: 'batch_01',
        houseId: 'house_01',
        startDate: startDate.toISOString(),
        totalCropDays: 20,
        growthProfileId: 'profile_01',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        endedAt: null,
      } as any);

      await expect(
        controller.publishActuatorOverride(
          { id: 'esp32_01' },
          { actuator: 'heater_air', state: true },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow heater_air ON when cropDay <= 8', async () => {
      deviceRegistryService.get.mockReturnValue(mockDevice);
      jest.useFakeTimers().setSystemTime(new Date('2026-07-14T07:30:00+07:00'));

      // Batch started 2 days ago
      const startDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      batchService.getActiveBatchByHouseId.mockResolvedValue({
        id: 'batch_01',
        houseId: 'house_01',
        startDate: startDate.toISOString(),
        totalCropDays: 20,
        growthProfileId: 'profile_01',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        endedAt: null,
      } as any);

      try {
        const result = await controller.publishActuatorOverride(
          { id: 'esp32_01' },
          { actuator: 'heater_air', state: true },
        );

        expect(result.message).toContain('đã được gửi đi');
        expect(mqttService.dispatchActuatorOverride).toHaveBeenCalledWith(
          'esp32_01',
          'heater_air',
          true,
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
