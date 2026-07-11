/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Subject } from 'rxjs';
import { TelemetryService, TelemetrySnapshot } from './telemetry.service';
import { MqttService, TelemetryEvent } from '../../mqtt/mqtt.service';
import { BatchService, BatchContext } from '../../batch/services/batch.service';
import { DatabaseService } from '../../database/database.service';
import { DeviceRegistryService } from '../../device/device-registry.service';

describe('TelemetryService', () => {
  let service: TelemetryService;
  let mqttService: jest.Mocked<MqttService>;
  let batchService: jest.Mocked<BatchService>;
  let dbService: jest.Mocked<DatabaseService>;
  let registry: jest.Mocked<DeviceRegistryService>;
  let telemetrySubject: Subject<TelemetryEvent>;

  const defaultContext: BatchContext = {
    batchId: 'batch-1',
    batch_id: 'batch-1',
    cropDay: 5,
    crop_day: 5,
    targetTemp: 25.0,
    target_temp: 25.0,
    targetHumid: 85.0,
    target_humid: 85.0,
    tempOptimalMin: 22.0,
    temp_optimal_min: 22.0,
    tempOptimalMax: 28.0,
    temp_optimal_max: 28.0,
    humidityOptimalMin: 70.0,
    humidity_optimal_min: 70.0,
    humidityOptimalMax: 90.0,
    humidity_optimal_max: 90.0,
    thermalShockProtection: true,
    thermal_shock_protection: true,
    thermalShockStart: '11:00:00',
    thermal_shock_start: '11:00:00',
    thermalShockEnd: '13:30:00',
    thermal_shock_end: '13:30:00',
    lightStatus: 'OFF',
    light_status: 'OFF',
  };

  beforeEach(async () => {
    telemetrySubject = new Subject<TelemetryEvent>();

    const mockMqttService = {
      telemetry$: telemetrySubject,
      dispatchSetpoint: jest.fn().mockResolvedValue(undefined),
    };

    const mockBatchService = {
      getBatchContext: jest.fn().mockResolvedValue(defaultContext),
    };

    const mockDatabaseService = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };

    registry = {
      get: jest.fn().mockReturnValue({
        deviceId: 'device-1',
        houseId: 'house-1',
        enabled: true,
        displayName: null,
        mqttUsername: 'device-1',
        lastSeenAt: null,
      }),
      refreshOne: jest.fn().mockResolvedValue(null),
      touchLastSeen: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelemetryService,
        { provide: MqttService, useValue: mockMqttService },
        { provide: BatchService, useValue: mockBatchService },
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: DeviceRegistryService, useValue: registry },
      ],
    }).compile();

    service = module.get<TelemetryService>(TelemetryService);
    mqttService = module.get(MqttService);
    batchService = module.get(BatchService);
    dbService = module.get(DatabaseService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should subscribe to mqttService.telemetry$', () => {
      const processTelemetrySpy = jest
        .spyOn(service, 'processTelemetry')
        .mockResolvedValue(undefined);
      service.onModuleInit();

      const event: TelemetryEvent = {
        deviceId: 'device-1',
        houseId: 'house-1',
        temp_air: 25.5,
        humidity_air: 80.0,
        co2_level: 800,
        receivedAt: new Date(),
        timestamp: new Date().toISOString(),
      };

      telemetrySubject.next(event);

      expect(processTelemetrySpy).toHaveBeenCalledWith(event);
    });
  });

  describe('calculateControlOutputs', () => {
    it('should activate mist generator when humidity is below target and not blackout', () => {
      const timestamp = new Date('2026-07-10T10:00:00+07:00');
      const event: TelemetryEvent = {
        deviceId: 'device-1',
        houseId: 'house-1',
        temp_air: 24.0,
        humidity_air: 80.0,
        co2_level: 600,
        receivedAt: timestamp,
        timestamp: timestamp.toISOString(),
      };

      const outputs = service.calculateControlOutputs(
        event,
        defaultContext,
        timestamp,
      );
      expect(outputs.mistGeneratorActive).toBe(true);
      expect(outputs.middayBlackoutActive).toBe(false);
    });

    it('should NOT activate mist generator when humidity is below target but midday blackout is active', () => {
      const timestamp = new Date('2026-07-10T12:00:00+07:00');
      const event: TelemetryEvent = {
        deviceId: 'device-1',
        houseId: 'house-1',
        temp_air: 24.0,
        humidity_air: 80.0,
        co2_level: 600,
        receivedAt: timestamp,
        timestamp: timestamp.toISOString(),
      };

      const outputs = service.calculateControlOutputs(
        event,
        defaultContext,
        timestamp,
      );
      expect(outputs.mistGeneratorActive).toBe(false);
      expect(outputs.middayBlackoutActive).toBe(true);
    });

    it('should activate fan when temperature is above target', () => {
      const timestamp = new Date('2026-07-10T10:00:00+07:00');
      const event: TelemetryEvent = {
        deviceId: 'device-1',
        houseId: 'house-1',
        temp_air: 26.5,
        humidity_air: 90.0,
        co2_level: 600,
        receivedAt: timestamp,
        timestamp: timestamp.toISOString(),
      };

      const outputs = service.calculateControlOutputs(
        event,
        defaultContext,
        timestamp,
      );
      expect(outputs.convectionFanActive).toBe(true);
    });

    it('should activate fan when CO2 is above 1000', () => {
      const timestamp = new Date('2026-07-10T10:00:00+07:00');
      const event: TelemetryEvent = {
        deviceId: 'device-1',
        houseId: 'house-1',
        temp_air: 24.0,
        humidity_air: 90.0,
        co2_level: 1050,
        receivedAt: timestamp,
        timestamp: timestamp.toISOString(),
      };

      const outputs = service.calculateControlOutputs(
        event,
        defaultContext,
        timestamp,
      );
      expect(outputs.convectionFanActive).toBe(true);
    });

    it('should activate heating lamp when temperature is below tempOptimalMin', () => {
      const timestamp = new Date('2026-07-10T10:00:00+07:00');
      const event: TelemetryEvent = {
        deviceId: 'device-1',
        houseId: 'house-1',
        temp_air: 21.0,
        humidity_air: 90.0,
        co2_level: 600,
        receivedAt: timestamp,
        timestamp: timestamp.toISOString(),
      };

      const outputs = service.calculateControlOutputs(
        event,
        defaultContext,
        timestamp,
      );
      expect(outputs.heatingLampActive).toBe(true);
    });

    it('should handle timezone-independent calculations for midday blackout (UTC timestamp)', () => {
      const timestamp = new Date('2026-07-10T04:30:00Z');
      const event: TelemetryEvent = {
        deviceId: 'device-1',
        houseId: 'house-1',
        temp_air: 24.0,
        humidity_air: 80.0,
        co2_level: 600,
        receivedAt: timestamp,
        timestamp: timestamp.toISOString(),
      };

      const outputs = service.calculateControlOutputs(
        event,
        defaultContext,
        timestamp,
      );
      expect(outputs.middayBlackoutActive).toBe(true);
      expect(outputs.mistGeneratorActive).toBe(false);
    });

    it('should NOT trigger midday blackout if thermalShockProtection is disabled', () => {
      const timestamp = new Date('2026-07-10T12:00:00+07:00');
      const noProtectionContext = {
        ...defaultContext,
        thermalShockProtection: false,
        thermal_shock_protection: false,
      };
      const event: TelemetryEvent = {
        deviceId: 'device-1',
        houseId: 'house-1',
        temp_air: 24.0,
        humidity_air: 80.0,
        co2_level: 600,
        receivedAt: timestamp,
        timestamp: timestamp.toISOString(),
      };

      const outputs = service.calculateControlOutputs(
        event,
        noProtectionContext,
        timestamp,
      );
      expect(outputs.middayBlackoutActive).toBe(false);
      expect(outputs.mistGeneratorActive).toBe(true);
    });
  });

  describe('getLatestTelemetry', () => {
    it('should return snapshot keyed by deviceId', () => {
      const snapshot: TelemetrySnapshot = {
        deviceId: 'device-1',
        houseId: 'house-1',
        time: new Date(),
        batchId: 'batch-1',
        cropDayInt: 5,
        humidityMeasured: 80,
        temperatureMeasured: 25,
        co2Measured: 600,
        humiditySetpoint: 85,
        temperatureSetpoint: 24,
        humidityErrorDelta: 5,
        temperatureErrorDelta: -1,
        mistGeneratorActive: true,
        convectionFanActive: false,
        heatingLampActive: false,
        middayBlackoutActive: false,
      };
      (service as any).latestCache.set('device-1', snapshot);
      expect(service.getLatestTelemetry('device-1')).toBe(snapshot);
      expect(service.getLatestTelemetry('other-device')).toBeNull();
    });
  });

  describe('getTelemetryHistory', () => {
    it('should throw BadRequest for invalid range', async () => {
      const from = new Date('2026-07-10T00:00:00Z');
      const to = new Date('2026-07-09T00:00:00Z');
      await expect(
        service.getTelemetryHistory('device-1', from, to),
      ).rejects.toThrow('from must be before to');
    });

    it('should throw for unknown device', async () => {
      registry.get.mockReturnValue(undefined);
      registry.refreshOne.mockResolvedValue(null);
      const from = new Date('2026-07-10T00:00:00Z');
      const to = new Date('2026-07-10T23:59:59Z');
      await expect(
        service.getTelemetryHistory('unknown-device', from, to),
      ).rejects.toThrow("Unknown device 'unknown-device'");
    });

    it('should call DB with houseId and bucket', async () => {
      const from = new Date('2026-07-10T00:00:00Z');
      const to = new Date('2026-07-10T23:59:59Z');
      const result = await service.getTelemetryHistory('device-1', from, to);
      expect(dbService.query).toHaveBeenCalled();
      expect(result).toBeInstanceOf(Array);
    });
  });
});