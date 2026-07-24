import { Test, TestingModule } from '@nestjs/testing';
import { Subject } from 'rxjs';
import { ControlHistoryInfluxWriter } from './control-history-influx-writer.service';
import { InfluxDbService } from './influx-db.service';
import { ConfigService } from './config.service';
import { MqttService, TelemetryEvent } from '../../mqtt/mqtt.service';
import { Point } from '@influxdata/influxdb-client';

describe('ControlHistoryInfluxWriter', () => {
  let writer: ControlHistoryInfluxWriter;
  let telemetrySubject: Subject<TelemetryEvent>;
  let mockWriteApi: any;
  let mockInfluxDbService: any;
  let mockConfigService: any;

  beforeEach(async () => {
    telemetrySubject = new Subject<TelemetryEvent>();
    mockWriteApi = {
      writePoint: jest.fn(),
      flush: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };

    mockInfluxDbService = {
      getWriteApi: jest.fn().mockReturnValue(mockWriteApi),
    };

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'INFLUXDB_BUCKET') return 'test_bucket';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ControlHistoryInfluxWriter,
        { provide: InfluxDbService, useValue: mockInfluxDbService },
        { provide: ConfigService, useValue: mockConfigService },
        {
          provide: MqttService,
          useValue: {
            telemetry$: telemetrySubject.asObservable(),
          },
        },
      ],
    }).compile();

    writer = module.get<ControlHistoryInfluxWriter>(ControlHistoryInfluxWriter);
  });

  afterEach(() => {
    telemetrySubject.complete();
  });

  it('should initialize and subscribe onModuleInit', () => {
    writer.onModuleInit();
    expect(mockConfigService.get).toHaveBeenCalledWith('INFLUXDB_BUCKET');
    expect(mockInfluxDbService.getWriteApi).toHaveBeenCalledWith(
      'test_bucket',
      'ms',
      expect.objectContaining({
        batchSize: 250,
        maxBufferLines: 1_000,
        maxRetries: 0,
        writeFailed: expect.any(Function),
      }),
    );
  });

  it('should process telemetry events and write to InfluxDB with dataQuality="good"', async () => {
    writer.onModuleInit();

    const event: TelemetryEvent = {
      deviceId: 'device-123',
      houseId: 'house-1',
      temp_air: 25.5,
      humidity_air: 80.2,
      co2_level: 600,
      control: {
        temperatureTarget: 24.0,
        humidityTarget: 85.0,
        co2Target: null,
        source: 'fuzzy',
        configRevision: 42,
      },
      actuators: {
        mist_active: true,
        fan_active: false,
        lamp_stage_active: true,
        lamp_stage2_active: false,
        heater_water_active: false,
        midday_blackout_active: false,
      },
      receivedAt: new Date('2026-07-21T03:00:00Z'),
      timestamp: '2026-07-21T03:00:00Z',
    };

    telemetrySubject.next(event);

    // Wait for async writePoint to finish
    await new Promise((resolve) => process.nextTick(resolve));

    expect(mockWriteApi.writePoint).toHaveBeenCalled();
    const pointArg = mockWriteApi.writePoint.mock.calls[0][0] as Point;
    expect(pointArg).toBeInstanceOf(Point);
    expect(pointArg.toString()).toContain('data_quality=good');
    expect(pointArg.toString()).toContain('device_id=device-123');
    expect(pointArg.toString()).toContain('control_source=fuzzy');
    expect(pointArg.toString()).toContain('temperature_c=25.5');
    expect(pointArg.toString()).toContain('humidity_percent=80.2');
    expect(pointArg.toString()).toContain('temp_target=24');
    expect(pointArg.toString()).toContain('humid_target=85');
    expect(pointArg.toString()).toContain('config_revision=42i');
    expect(pointArg.toString()).toContain('mist_state=T');
    expect(pointArg.toString()).toContain('lamp_state=T');
    expect(pointArg.toString()).toContain('fan_state=F');
  });

  it('should map to "degraded" dataQuality if sensor or actuator values are null', async () => {
    writer.onModuleInit();

    const event: TelemetryEvent = {
      deviceId: 'device-123',
      houseId: 'house-1',
      temp_air: null, // trigger degraded
      humidity_air: 80.2,
      co2_level: 600,
      control: {
        temperatureTarget: 24.0,
        humidityTarget: 85.0,
        co2Target: null,
        source: 'fuzzy',
        configRevision: 42,
      },
      actuators: {
        mist_active: true,
        fan_active: false,
        lamp_stage_active: true,
        lamp_stage2_active: false,
        heater_water_active: false,
        midday_blackout_active: false,
      },
      receivedAt: new Date('2026-07-21T03:00:00Z'),
      timestamp: '2026-07-21T03:00:00Z',
    };

    telemetrySubject.next(event);
    await new Promise((resolve) => process.nextTick(resolve));

    expect(mockWriteApi.writePoint).toHaveBeenCalled();
    const pointArg = mockWriteApi.writePoint.mock.calls[0][0];
    expect(pointArg.toString()).toContain('data_quality=degraded');
    expect(pointArg.toString()).not.toContain('temperature_c=0');
    expect(pointArg.toString()).not.toContain('temperature_c=');
  });

  it('should map to "missing_target" dataQuality if control targets are null/missing', async () => {
    writer.onModuleInit();

    const event: TelemetryEvent = {
      deviceId: 'device-123',
      houseId: 'house-1',
      temp_air: 25.5,
      humidity_air: 80.2,
      co2_level: 600,
      control: null, // trigger missing_target
      actuators: {
        mist_active: true,
        fan_active: false,
        lamp_stage_active: true,
        lamp_stage2_active: false,
        heater_water_active: false,
        midday_blackout_active: false,
      },
      receivedAt: new Date('2026-07-21T03:00:00Z'),
      timestamp: '2026-07-21T03:00:00Z',
    };

    telemetrySubject.next(event);
    await new Promise((resolve) => process.nextTick(resolve));

    expect(mockWriteApi.writePoint).toHaveBeenCalled();
    const pointArg = mockWriteApi.writePoint.mock.calls[0][0];
    expect(pointArg.toString()).toContain('data_quality=missing_target');
  });

  it.each([
    ['temperature target', { temperatureTarget: null }, 'missing_target'],
    ['humidity target', { humidityTarget: null }, 'missing_target'],
    ['source', { source: null }, 'degraded'],
    ['config revision', { configRevision: null }, 'degraded'],
    [
      'source and config revision',
      { source: null, configRevision: null },
      'degraded',
    ],
  ])(
    'does not mark telemetry good when Core-1 %s is missing',
    async (_name, controlPatch, expectedQuality) => {
      writer.onModuleInit();
      telemetrySubject.next({
        deviceId: 'device-123',
        houseId: 'house-1',
        temp_air: 25.5,
        humidity_air: 80.2,
        co2_level: 600,
        control: {
          temperatureTarget: 24,
          humidityTarget: 85,
          co2Target: null,
          source: 'fuzzy',
          configRevision: 42,
          ...controlPatch,
        },
        actuators: {
          mist_active: true,
          fan_active: false,
          lamp_stage_active: true,
          lamp_stage2_active: false,
          heater_water_active: false,
          midday_blackout_active: false,
        },
        receivedAt: new Date('2026-07-21T03:00:00Z'),
        timestamp: '2026-07-21T03:00:00Z',
      });
      await new Promise((resolve) => process.nextTick(resolve));
      expect(
        (mockWriteApi.writePoint.mock.calls[0][0] as Point).toString(),
      ).toContain(`data_quality=${expectedQuality}`);
    },
  );

  it('should continue the MQTT pipeline when Influx receives a burst', async () => {
    writer.onModuleInit();

    const event1: TelemetryEvent = {
      deviceId: 'device-123',
      houseId: 'house-1',
      temp_air: 25.5,
      humidity_air: 80.2,
      co2_level: 600,
      control: null,
      actuators: {
        mist_active: true,
        fan_active: false,
        lamp_stage_active: true,
        lamp_stage2_active: false,
        heater_water_active: false,
        midday_blackout_active: false,
      },
      receivedAt: new Date('2026-07-21T03:00:00Z'),
      timestamp: '2026-07-21T03:00:00Z',
    };

    for (let index = 0; index < 100; index += 1) {
      telemetrySubject.next({ ...event1, deviceId: `device-${index}` });
    }
    await new Promise((resolve) => process.nextTick(resolve));

    expect(mockWriteApi.writePoint).toHaveBeenCalledTimes(100);
    expect(mockWriteApi.flush).not.toHaveBeenCalled();
  });

  it('should clean up onModuleDestroy', async () => {
    writer.onModuleInit();
    await writer.onModuleDestroy();
    expect(mockWriteApi.close).toHaveBeenCalled();
  });

  it('drops asynchronous write failures without creating an unhandled rejection', async () => {
    writer.onModuleInit();
    const options = mockInfluxDbService.getWriteApi.mock.calls[0][2];
    await expect(
      options.writeFailed(new Error('offline'), [
        'controller_history,device_id=device-123 value=1',
      ]),
    ).resolves.toBeUndefined();
  });
});
