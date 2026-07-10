/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Subject } from 'rxjs';
import { TelemetryService, TelemetrySnapshot } from './telemetry.service';
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

    it('should handle timezone-independent calculations for midday blackout (UTC timestamp)', () => {
      // 11:30 AM Asia/Ho_Chi_Minh is 04:30 AM UTC
      const timestamp = new Date('2026-07-10T04:30:00Z');
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
      expect(outputs.middayBlackoutActive).toBe(true);
      expect(outputs.mistGeneratorActive).toBe(false); // blocked by blackout
    });

    it('should NOT trigger midday blackout if thermalShockProtection is disabled', () => {
      const timestamp = new Date('2026-07-10T12:00:00+07:00');
      const noProtectionContext = {
        ...defaultContext,
        thermalShockProtection: false,
        thermal_shock_protection: false,
      };
      const event: TelemetryEvent = {
        deviceId: 'house-1',
        temp_air: 24.0,
        humidity_air: 80.0,
        co2_level: 600,
        timestamp: timestamp.toISOString(),
      };

      const outputs = service.calculateControlOutputs(
        event,
        noProtectionContext,
        timestamp,
      );
      expect(outputs.middayBlackoutActive).toBe(false);
      expect(outputs.mistGeneratorActive).toBe(true); // mist active because no blackout
    });

    it('should check midday blackout boundary conditions', () => {
      const startTimestamp = new Date('2026-07-10T11:00:00+07:00');
      const endTimestamp = new Date('2026-07-10T13:30:00+07:00');
      const justBeforeTimestamp = new Date('2026-07-10T10:59:00+07:00');
      const justAfterTimestamp = new Date('2026-07-10T13:31:00+07:00');

      const event: TelemetryEvent = {
        deviceId: 'house-1',
        temp_air: 24.0,
        humidity_air: 80.0,
        co2_level: 600,
        timestamp: startTimestamp.toISOString(),
      };

      expect(
        service.calculateControlOutputs(event, defaultContext, startTimestamp)
          .middayBlackoutActive,
      ).toBe(true);
      expect(
        service.calculateControlOutputs(event, defaultContext, endTimestamp)
          .middayBlackoutActive,
      ).toBe(true);
      expect(
        service.calculateControlOutputs(
          event,
          defaultContext,
          justBeforeTimestamp,
        ).middayBlackoutActive,
      ).toBe(false);
      expect(
        service.calculateControlOutputs(
          event,
          defaultContext,
          justAfterTimestamp,
        ).middayBlackoutActive,
      ).toBe(false);
    });

    it('should keep heating lamp and convection fan OFF when temperature is optimal (between tempOptimalMin and targetTemp)', () => {
      const timestamp = new Date('2026-07-10T10:00:00+07:00');
      const event: TelemetryEvent = {
        deviceId: 'house-1',
        temp_air: 23.5, // > 22.0 (optimal min) and < 25.0 (target)
        humidity_air: 90.0,
        co2_level: 600,
        timestamp: timestamp.toISOString(),
      };

      const outputs = service.calculateControlOutputs(
        event,
        defaultContext,
        timestamp,
      );
      expect(outputs.heatingLampActive).toBe(false);
      expect(outputs.convectionFanActive).toBe(false);
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

  describe('getTelemetryHistory', () => {
    it('should query telemetry logs and map database columns to camelCase properties', async () => {
      const from = new Date('2026-07-10T00:00:00Z');
      const to = new Date('2026-07-10T23:59:59Z');
      const mockRows = [
        {
          time: new Date('2026-07-10T12:00:00Z').toISOString(),
          batchId: 'batch-123',
          houseId: 'house-1',
          cropDayInt: 5,
          humidityMeasured: '80.5',
          temperatureMeasured: '24.2',
          co2Measured: 950,
          humiditySetpoint: '85.0',
          temperatureSetpoint: '25.0',
          humidityErrorDelta: '4.5',
          temperatureErrorDelta: '0.8',
          mistGeneratorActive: true,
          convectionFanActive: false,
          heatingLampActive: false,
          middayBlackoutActive: false,
        },
        {
          time: new Date('2026-07-10T12:01:00Z').toISOString(),
          batchId: 'idle',
          houseId: 'house-1',
          cropDayInt: 1,
          humidityMeasured: null,
          temperatureMeasured: null,
          co2Measured: null,
          humiditySetpoint: null,
          temperatureSetpoint: null,
          humidityErrorDelta: null,
          temperatureErrorDelta: null,
          mistGeneratorActive: false,
          convectionFanActive: false,
          heatingLampActive: false,
          middayBlackoutActive: false,
        },
      ];

      dbService.query.mockResolvedValueOnce({ rows: mockRows });

      const history = await service.getTelemetryHistory('house-1', from, to);

      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['house-1', from, to],
      );
      expect(history.length).toBe(2);
      expect(history[0].batchId).toBe('batch-123');
      expect(history[0].humidityMeasured).toBe(80.5);
      expect(history[0].temperatureMeasured).toBe(24.2);
      expect(history[1].batchId).toBeNull(); // mapped from 'idle'
      expect(history[1].humidityMeasured).toBeNull();
    });
  });

  describe('telemetryUpdates$', () => {
    it('should emit a snapshot when updateCache is called', async () => {
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

      const emitPromise = new Promise<TelemetrySnapshot>((resolve) => {
        service.telemetryUpdates$.subscribe((snapshot) => {
          resolve(snapshot);
        });
      });

      await service.processTelemetry(event);

      const emitted = await emitPromise;
      expect(emitted).toBeDefined();
      expect(emitted.houseId).toBe('house-1');
      expect(emitted.batchId).toBe('batch-1');
      expect(emitted.humidityMeasured).toBe(80.0);
    });
  });
});
