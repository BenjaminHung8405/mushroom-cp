/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Subject } from 'rxjs';
import { TelemetryService } from './telemetry.service';
import { MqttService, TelemetryEvent } from '../../mqtt/mqtt.service';
import { BatchService, BatchContext } from '../../batch/services/batch.service';
import { DatabaseService } from '../../database/database.service';

describe('TelemetryService', () => {
  let service: TelemetryService;
  let mqttService: jest.Mocked<MqttService>;
  let batchService: jest.Mocked<BatchService>;
  let dbService: jest.Mocked<DatabaseService>;
  let telemetrySubject: Subject<TelemetryEvent>;

  beforeEach(async () => {
    telemetrySubject = new Subject<TelemetryEvent>();

    const mockMqttService = {
      telemetry$: telemetrySubject,
      dispatchSetpoint: jest.fn(),
    };

    const mockBatchService = {
      getBatchContext: jest.fn(),
    };

    const mockDatabaseService = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelemetryService,
        { provide: MqttService, useValue: mockMqttService },
        { provide: BatchService, useValue: mockBatchService },
        { provide: DatabaseService, useValue: mockDatabaseService },
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
        deviceId: 'house-1',
        temp_air: 25.5,
        humidity_air: 80.0,
        co2_level: 800,
        timestamp: new Date().toISOString(),
      };

      telemetrySubject.next(event);

      expect(processTelemetrySpy).toHaveBeenCalledWith(event);
    });
  });

  describe('calculateControlOutputs', () => {
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

    it('should activate mist generator when humidity is below target and not blackout', () => {
      const timestamp = new Date('2026-07-10T10:00:00+07:00'); // 10:00 AM (not blackout)
      const event: TelemetryEvent = {
        deviceId: 'house-1',
        temp_air: 24.0,
        humidity_air: 80.0, // below 85.0
        co2_level: 600,
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
      const timestamp = new Date('2026-07-10T12:00:00+07:00'); // 12:00 PM (blackout)
      const event: TelemetryEvent = {
        deviceId: 'house-1',
        temp_air: 24.0,
        humidity_air: 80.0,
        co2_level: 600,
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
        deviceId: 'house-1',
        temp_air: 26.5, // above 25.0
        humidity_air: 90.0,
        co2_level: 600,
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
        deviceId: 'house-1',
        temp_air: 24.0,
        humidity_air: 90.0,
        co2_level: 1050, // above 1000
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
        deviceId: 'house-1',
        temp_air: 21.0, // below 22.0
        humidity_air: 90.0,
        co2_level: 600,
        timestamp: timestamp.toISOString(),
      };

      const outputs = service.calculateControlOutputs(
        event,
        defaultContext,
        timestamp,
      );
      expect(outputs.heatingLampActive).toBe(true);
    });
  });

  describe('processTelemetry', () => {
    it('should perform normal processing cycle', async () => {
      const event: TelemetryEvent = {
        deviceId: 'house-1',
        temp_air: 24.0,
        humidity_air: 80.0,
        co2_level: 800,
        timestamp: new Date().toISOString(),
      };

      const context: BatchContext = {
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
        thermalShockProtection: false,
        thermal_shock_protection: false,
        thermalShockStart: '11:00:00',
        thermal_shock_start: '11:00:00',
        thermalShockEnd: '13:30:00',
        thermal_shock_end: '13:30:00',
        lightStatus: 'OFF',
        light_status: 'OFF',
      };

      batchService.getBatchContext.mockResolvedValue(context);

      await service.processTelemetry(event);

      // Check DB Insert called
      expect(dbService.query).toHaveBeenCalled();

      // Check cache updated
      const snapshot = service.getLatestTelemetry('house-1');
      expect(snapshot).toBeDefined();
      expect(snapshot?.batchId).toBe('batch-1');
      expect(snapshot?.mistGeneratorActive).toBe(true); // 80.0 < 85.0
      expect(snapshot?.convectionFanActive).toBe(false);

      // Check MQTT setpoint dispatched
      expect(mqttService.dispatchSetpoint).toHaveBeenCalledWith('house-1', {
        mist_generator_active: true,
        convection_fan_active: false,
        heating_lamp_active: false,
        midday_blackout_active: false,
      });
    });

    it('should trigger Idle Guard when batchId is null', async () => {
      const event: TelemetryEvent = {
        deviceId: 'house-1',
        temp_air: 20.0,
        humidity_air: 50.0,
        co2_level: 1500,
        timestamp: new Date().toISOString(),
      };

      const idleContext: BatchContext = {
        batchId: null,
        batch_id: null,
        cropDay: 1,
        crop_day: 1,
        targetTemp: 31.5,
        target_temp: 31.5,
        targetHumid: 80.0,
        target_humid: 80.0,
        tempOptimalMin: 28.0,
        temp_optimal_min: 28.0,
        tempOptimalMax: 35.0,
        temp_optimal_max: 35.0,
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

      batchService.getBatchContext.mockResolvedValue(idleContext);

      await service.processTelemetry(event);

      // Verify that despite temp/humidity/co2 triggers, everything is set to false (idle guard)
      expect(mqttService.dispatchSetpoint).toHaveBeenCalledWith('house-1', {
        mist_generator_active: false,
        convection_fan_active: false,
        heating_lamp_active: false,
        midday_blackout_active: false,
      });

      const snapshot = service.getLatestTelemetry('house-1');
      expect(snapshot?.batchId).toBeNull();
      expect(snapshot?.mistGeneratorActive).toBe(false);
      expect(snapshot?.convectionFanActive).toBe(false);
      expect(snapshot?.heatingLampActive).toBe(false);
    });

    it('should activate Emergency Fallback on database or processing errors', async () => {
      const event: TelemetryEvent = {
        deviceId: 'house-1',
        temp_air: 24.0,
        humidity_air: 80.0,
        co2_level: 800,
        timestamp: new Date().toISOString(),
      };

      batchService.getBatchContext.mockRejectedValue(
        new Error('DB Connection Timeout'),
      );

      await service.processTelemetry(event);

      // Verify emergency fallback is dispatched (mist OFF, fan ON, lamp OFF)
      expect(mqttService.dispatchSetpoint).toHaveBeenCalledWith('house-1', {
        mist_generator_active: false,
        convection_fan_active: true,
        heating_lamp_active: false,
        midday_blackout_active: false,
      });
    });

    it('should handle MQTT dispatch errors without crashing or losing exception propagation', async () => {
      const event: TelemetryEvent = {
        deviceId: 'house-1',
        temp_air: 24.0,
        humidity_air: 80.0,
        co2_level: 800,
        timestamp: new Date().toISOString(),
      };

      const context: BatchContext = {
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
        thermalShockProtection: false,
        thermal_shock_protection: false,
        thermalShockStart: '11:00:00',
        thermal_shock_start: '11:00:00',
        thermalShockEnd: '13:30:00',
        thermal_shock_end: '13:30:00',
        lightStatus: 'OFF',
        light_status: 'OFF',
      };

      batchService.getBatchContext.mockResolvedValue(context);
      mqttService.dispatchSetpoint.mockImplementation(() => {
        throw new Error('MQTT Connection Lost');
      });

      // Should not throw exception since errors in finally dispatch block are handled
      await expect(service.processTelemetry(event)).resolves.not.toThrow();
    });
  });
});
