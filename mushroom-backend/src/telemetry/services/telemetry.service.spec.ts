/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Subject } from 'rxjs';
import { TelemetryService, TelemetrySnapshot } from './telemetry.service';
import { MqttService, TelemetryEvent } from '../../mqtt/mqtt.service';
import { BatchService, BatchContext } from '../../batch/services/batch.service';
import { DatabaseService } from '../../database/database.service';
import { DeviceRegistryService } from '../../device/device-registry.service';
import { OfflineSyncService } from '../../offline-sync/offline-sync.service';
import type { OfflineSyncBurst } from '../../mqtt/offline-sync';

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
    lightStatus: 'OFF',
    light_status: 'OFF',
  };

  beforeEach(async () => {
    telemetrySubject = new Subject<TelemetryEvent>();

    const manualAckSubject = new Subject<{ deviceId: string; ack: any }>();
    const mockMqttService = {
      telemetry$: telemetrySubject,
      manualAck$: manualAckSubject,
      dispatchSetpoint: jest.fn().mockResolvedValue(undefined),
      acknowledgeOfflineSyncBurst: jest.fn().mockResolvedValue(undefined),
    };

    const mockBatchService = {
      getBatchContext: jest.fn().mockResolvedValue(defaultContext),
    };

    const mockDatabaseService = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      transaction: jest.fn(async (work) =>
        work(jest.fn().mockResolvedValue({ rows: [] })),
      ),
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
      getEnabled: jest.fn(),
      loadAll: jest.fn(),
      onModuleInit: jest.fn(),
      upsertCache: jest.fn(),
      invalidate: jest.fn(),
      listCached: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelemetryService,
        { provide: MqttService, useValue: mockMqttService },
        { provide: BatchService, useValue: mockBatchService },
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: DeviceRegistryService, useValue: registry },
        {
          provide: OfflineSyncService,
          useValue: { writeBurst: jest.fn().mockResolvedValue(undefined) },
        },
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
        actuators: null,
        receivedAt: new Date(),
        timestamp: new Date().toISOString(),
      };

      telemetrySubject.next(event);

      expect(processTelemetrySpy).toHaveBeenCalledWith(event);
    });
  });

  describe('edge-authoritative actuator persistence', () => {
    const event = (actuators: TelemetryEvent['actuators']): TelemetryEvent => ({
      deviceId: 'device-1',
      houseId: 'house-1',
      temp_air: 25,
      humidity_air: 80,
      co2_level: 600,
      actuators,
      receivedAt: new Date('2026-07-10T10:00:00Z'),
      timestamp: '2026-07-10T10:00:00Z',
    });

    it('stores and streams the complete edge actuator state without deriving outputs', async () => {
      const updates: TelemetrySnapshot[] = [];
      service.telemetryUpdates$.subscribe((snapshot) => updates.push(snapshot));
      await service.processTelemetry(
        event({
          mist_active: true,
          fan_active: false,
          lamp_stage_active: true,
          lamp_stage2_active: false,
          heater_water_active: false,
          midday_blackout_active: true,
        }),
      );
      expect(dbService.query).toHaveBeenCalledWith(
        expect.stringContaining('lamp_stage_active'),
        expect.arrayContaining([true, false, true, false, false, true]),
      );
      expect(updates[0]).toMatchObject({
        mistGeneratorActive: true,
        convectionFanActive: false,
        lampStageActive: true,
        lampStage2Active: false,
        heaterWaterActive: false,
        middayBlackoutActive: true,
      });
    });

    it('keeps legacy or unavailable edge actuator fields null', async () => {
      const updates: TelemetrySnapshot[] = [];
      service.telemetryUpdates$.subscribe((snapshot) => updates.push(snapshot));
      await service.processTelemetry(event(null));
      expect(updates[0]).toMatchObject({
        mistGeneratorActive: null,
        convectionFanActive: null,
        lampStageActive: null,
        lampStage2Active: null,
        heaterWaterActive: null,
        middayBlackoutActive: null,
      });
    });
  });

  describe('getLatestTelemetry', () => {
    it('should return snapshot keyed by deviceId from cache if present', async () => {
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
        lampStageActive: false,
        lampStage2Active: false,
        heaterWaterActive: false,
        middayBlackoutActive: false,
      };
      (service as any).latestCache.set('device-1', snapshot);
      const res = await service.getLatestTelemetry('device-1');
      expect(res).toBe(snapshot);
    });

    it('should query database and return mapped snapshot on cache miss', async () => {
      registry.get.mockReturnValue({
        deviceId: 'device-1',
        houseId: 'house-1',
        enabled: true,
        displayName: null,
        mqttUsername: 'device-1',
        lastSeenAt: null,
      });

      const dbRow = {
        time: new Date().toISOString(),
        batchId: 'batch-1',
        houseId: 'house-1',
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
        lampStageActive: false,
        lampStage2Active: false,
        heaterWaterActive: false,
        middayBlackoutActive: false,
      };

      dbService.query.mockResolvedValue({ rows: [dbRow] });

      const res = await service.getLatestTelemetry('device-1');
      expect(res).toBeDefined();
      expect(res?.deviceId).toBe('device-1');
      expect(res?.humidityMeasured).toBe(80);
      expect(dbService.query).toHaveBeenCalled();
    });

    it('should return null if cache miss and database has no logs', async () => {
      registry.get.mockReturnValue({
        deviceId: 'device-1',
        houseId: 'house-1',
        enabled: true,
        displayName: null,
        mqttUsername: 'device-1',
        lastSeenAt: null,
      });
      dbService.query.mockResolvedValue({ rows: [] });

      const res = await service.getLatestTelemetry('device-1');
      expect(res).toBeNull();
    });

    it('should return null if device is disabled', async () => {
      registry.get.mockReturnValue({
        deviceId: 'device-1',
        houseId: 'house-1',
        enabled: false,
        displayName: null,
        mqttUsername: 'device-1',
        lastSeenAt: null,
      });

      const res = await service.getLatestTelemetry('device-1');
      expect(res).toBeNull();
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

  describe('handleManualAck normalisation', () => {
    it('stores a wall-clock expiry derived from firmware millis', () => {
      service.handleManualAck('device-1', {
        channel: 0,
        requestedIntent: 1,
        decision: 0,
        effectiveIntent: 1,
        releaseReason: 0,
        expiresMs: 1_900_000,
        ackMs: 1_000_000,
        receivedAt: new Date('2026-07-16T12:00:00Z'),
      });

      const storedAck = (service as any).manualAcks.get('device-1').mistAck;
      expect(storedAck).toEqual({
        channel: 0,
        requested_intent: 'on',
        decision: 0,
        effective_intent: 'on',
        release_reason: null,
        expires_ms: new Date('2026-07-16T12:15:00Z').getTime(),
        ack_ms: new Date('2026-07-16T12:00:00Z').getTime(),
      });
    });
  });
  describe('offline sync delivery', () => {
    const burst: OfflineSyncBurst = {
      bootCount: 4,
      chunkIndex: 2,
      chunkCrc32: 9,
      sessionLastDeltaS: 30,
      records: [
        {
          bootCount: 4,
          deltaTimeS: 0,
          temp: 25,
          humid: 80,
          mistState: true,
          lampState: false,
        },
      ],
    };

    it('writes Influx and PostgreSQL before acknowledging a new chunk', async () => {
      const writer = (service as any).offlineSync as { writeBurst: jest.Mock };
      await (service as any).processOfflineSyncBurst(
        'device-1',
        'house-1',
        new Date('2026-07-19T10:00:00.000Z'),
        burst,
      );
      expect(writer.writeBurst).toHaveBeenCalledWith(
        'device-1',
        burst,
        expect.any(Date),
      );
      expect(dbService.transaction).toHaveBeenCalledTimes(1);
      expect(
        mqttService.acknowledgeOfflineSyncBurst as jest.Mock,
      ).toHaveBeenCalledWith('device-1', burst);
    });

    it('withholds ACK and receipt transaction when Influx write fails', async () => {
      const writer = (service as any).offlineSync as { writeBurst: jest.Mock };
      writer.writeBurst.mockRejectedValueOnce(new Error('Influx down'));
      await expect(
        (service as any).processOfflineSyncBurst(
          'device-1',
          'house-1',
          new Date(),
          burst,
        ),
      ).rejects.toThrow('Influx down');
      expect(dbService.transaction).not.toHaveBeenCalled();
      expect(
        mqttService.acknowledgeOfflineSyncBurst as jest.Mock,
      ).not.toHaveBeenCalled();
    });

    it('replays ACK without duplicate persistence when receipt exists', async () => {
      dbService.query.mockResolvedValueOnce({ rows: [{ exists: 1 }] });
      const writer = (service as any).offlineSync as { writeBurst: jest.Mock };
      await (service as any).processOfflineSyncBurst(
        'device-1',
        'house-1',
        new Date(),
        burst,
      );
      expect(writer.writeBurst).not.toHaveBeenCalled();
      expect(dbService.transaction).not.toHaveBeenCalled();
      expect(
        mqttService.acknowledgeOfflineSyncBurst as jest.Mock,
      ).toHaveBeenCalledWith('device-1', burst);
    });
  });
});
