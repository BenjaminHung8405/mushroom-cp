import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { MqttService, DeviceStatusEvent, TelemetryEvent } from './mqtt.service';
import * as mqtt from 'mqtt';
import { DeviceRegistryService } from '../device/device-registry.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Device } from '../device/entities/device.entity';
import { MqttAuthService } from '../mqtt-auth/mqtt-auth.service';

const mockMqttClient = {
  on: jest.fn(),
  subscribe: jest.fn(
    (topic: string, opts: unknown, cb?: (err: Error | null) => void) => {
      if (cb) cb(null);
      return {} as mqtt.MqttClient;
    },
  ),
  publish: jest.fn(
    (
      topic: string,
      message: string | Buffer,
      opts: unknown,
      cb?: (err?: Error) => void,
    ) => {
      if (cb) cb();
      return {} as mqtt.MqttClient;
    },
  ),
  end: jest.fn(() => ({}) as mqtt.MqttClient),
  connected: true,
};

jest.mock('mqtt', () => ({
  connect: jest.fn(() => mockMqttClient),
}));

describe('MqttService', () => {
  let service: MqttService;
  let registry: jest.Mocked<DeviceRegistryService>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockMqttClient.connected = true;
    process.env.IOT_TENANT = 'mushroom';
    process.env.MQTT_USERNAME = 'test_user';
    process.env.MQTT_PASSWORD = 'test_password';
    process.env.MQTT_HOST = 'localhost';
    process.env.MQTT_PORT = '1883';

    registry = {
      getEnabled: jest.fn().mockReturnValue({
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
        MqttService,
        { provide: DeviceRegistryService, useValue: registry },
        { provide: getRepositoryToken(Device), useValue: { findOne: jest.fn(), create: jest.fn(), save: jest.fn() } },
        { provide: MqttAuthService, useValue: { enforceProvisionRateLimit: jest.fn() } },
      ],
    }).compile();

    service = module.get<MqttService>(MqttService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Incoming Messages Handling', () => {
    let messageCallback: (topic: string, payload: Buffer) => void = () => {};

    beforeEach(() => {
      mockMqttClient.on.mockImplementation(
        (event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'message') {
            messageCallback = cb;
          }
        },
      );
      service.onModuleInit();
    });

    it('should drop telemetry from unknown device and trigger refresh', (done) => {
      registry.getEnabled.mockReturnValue(undefined);
      const nextTelemetrySpy = jest.spyOn(service.telemetry$, 'next');

      messageCallback(
        'mushroom/esp32/unknown-device/up/telemetry',
        Buffer.from(JSON.stringify({ readings: { temperature_celsius: 25.5, humidity_percent: 80 } })),
      );

      expect(nextTelemetrySpy).not.toHaveBeenCalled();
      expect(registry.refreshOne).toHaveBeenCalledWith('unknown-device');
      done();
    });

    it('should drop telemetry from disabled device', (done) => {
      registry.getEnabled.mockReturnValue(undefined); // disabled returns undefined
      const nextTelemetrySpy = jest.spyOn(service.telemetry$, 'next');

      messageCallback(
        'mushroom/esp32/disabled-dev/up/telemetry',
        Buffer.from(JSON.stringify({ readings: { temperature_celsius: 25.5, humidity_percent: 80 } })),
      );

      expect(nextTelemetrySpy).not.toHaveBeenCalled();
      done();
    });

    it('should resolve deviceId → houseId via registry for telemetry', (done) => {
      service.telemetry$.subscribe({
        next: (event: TelemetryEvent) => {
          expect(event.deviceId).toBe('device-1');
          expect(event.houseId).toBe('house-1');
          expect(event.temp_air).toBe(25.5);
          expect(event.humidity_air).toBe(80);
          expect(event.actuators).toBeNull();
          expect(event.receivedAt).toBeInstanceOf(Date);
          done();
        },
      });

      messageCallback(
        'mushroom/esp32/device-1/up/telemetry',
        Buffer.from(JSON.stringify({ readings: { temperature_celsius: 25.5, humidity_percent: 80 } })),
      );
    });

    it('should preserve a complete actuator state from edge telemetry', (done) => {
      service.telemetry$.subscribe((event) => {
        expect(event.actuators).toEqual({
          mist_active: true,
          fan_active: false,
          lamp_stage_active: true,
          lamp_stage2_active: false,
          heater_water_active: false,
          midday_blackout_active: true,
        });
        done();
      });
      messageCallback(
        'mushroom/esp32/device-1/up/telemetry',
        Buffer.from(
          JSON.stringify({
            readings: { temperature_celsius: 25.5 },
            actuator_states: {
              relay_1: 'ON',
              relay_2: 'OFF',
              relay_3: 'OFF',
              relay_4: 'ON',
              midday_blackout_active: true,
            },
          }),
        ),
      );
    });

    it('marks blackout unavailable when the edge omits the field', (done) => {
      service.telemetry$.subscribe((event) => {
        expect(event.actuators?.midday_blackout_active).toBeNull();
        done();
      });
      messageCallback(
        'mushroom/esp32/device-1/up/telemetry',
        Buffer.from(JSON.stringify({
          readings: { temperature_celsius: 25.5, humidity_percent: 80 },
          actuator_states: { relay_1: 'OFF', relay_2: 'OFF', relay_3: 'OFF', relay_4: 'OFF' },
        })),
      );
    });

    it('should route manual ACK to manualAck$ Subject', (done) => {
      const nextAckSpy = jest.spyOn(service.manualAck$, 'next');

      messageCallback(
        'mushroom/esp32/device-1/up/manual/ack',
        Buffer.from(JSON.stringify({
          channel: 0,
          requested_intent: 1,
          decision: 0,
          effective_intent: 1,
          release_reason: 0,
          expires_ms: 900000,
          ack_ms: 1000000,
        })),
      );

      expect(nextAckSpy).toHaveBeenCalled();
      const callArg = nextAckSpy.mock.calls[0][0];
      expect(callArg.deviceId).toBe('device-1');
      expect(callArg.ack.channel).toBe(0);
      expect(callArg.ack.effectiveIntent).toBe(1);
      done();
    });

    it('should drop malformed manual ACK with invalid channel', (done) => {
      const nextAckSpy = jest.spyOn(service.manualAck$, 'next');

      messageCallback(
        'mushroom/esp32/device-1/up/manual/ack',
        Buffer.from(JSON.stringify({
          channel: 99,
          requested_intent: 1,
          decision: 0,
          effective_intent: 1,
          release_reason: 0,
          expires_ms: 900000,
          ack_ms: 1000000,
        })),
      );

      expect(nextAckSpy).not.toHaveBeenCalled();
      done();
    });

    it('marks partial or malformed actuator state unavailable without dropping sensor telemetry', (done) => {
      service.telemetry$.subscribe((event) => {
        expect(event.actuators).toBeNull();
        done();
      });
      messageCallback(
        'mushroom/esp32/device-1/up/telemetry',
        Buffer.from(
          JSON.stringify({
            readings: { temperature_celsius: 25.5 },
            actuator_states: { relay_1: 'ON' },
          }),
        ),
      );
    });

    it('should reject telemetry with no canonical finite metrics', (done) => {
      const nextTelemetrySpy = jest.spyOn(service.telemetry$, 'next');

      messageCallback(
        'mushroom/esp32/device-1/up/telemetry',
        Buffer.from(JSON.stringify({ foo: 'bar' })),
      );

      expect(nextTelemetrySpy).not.toHaveBeenCalled();
      done();
    });

    it('should resolve deviceId → houseId for status events', (done) => {
      service.deviceStatus$.subscribe({
        next: (event: DeviceStatusEvent) => {
          expect(event.deviceId).toBe('device-1');
          expect(event.houseId).toBe('house-1');
          expect(event.status).toBe('online');
          done();
        },
      });

      messageCallback(
        'mushroom/esp32/device-1/status',
        Buffer.from(JSON.stringify({ online: true })),
      );
    });

    it('should reject oversized payloads', (done) => {
      const nextTelemetrySpy = jest.spyOn(service.telemetry$, 'next');
      const bigPayload = Buffer.alloc(2048, 'A');

      messageCallback('mushroom/esp32/device-1/up/telemetry', bigPayload);

      expect(nextTelemetrySpy).not.toHaveBeenCalled();
      done();
    });

    it('should dispatch advisory setpoint via MQTT', async () => {
      await service.dispatchSetpoint('device-1', {
        temperatureSetpoint: 30,
        humiditySetpoint: 85,
        control_mode: 'fuzzy_tpc',
        setpoint_ttl_sec: 120,
      });

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        'mushroom/esp32/device-1/down/command',
        expect.stringContaining('"action":"SET_BASELINE_SETPOINT"'),
        { qos: 1, retain: false },
        expect.any(Function),
      );
    });

    it('should throw when dispatching while disconnected', async () => {
      mockMqttClient.connected = false;
      await expect(
        service.dispatchSetpoint('device-1', {
          temperatureSetpoint: 30,
          humiditySetpoint: 85,
          control_mode: 'fuzzy_tpc',
          setpoint_ttl_sec: 120,
        }),
      ).rejects.toThrow('MQTT client is not connected');
    });
  });
});
