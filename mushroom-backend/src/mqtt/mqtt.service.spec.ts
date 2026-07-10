import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { MqttService, DeviceStatusEvent, TelemetryEvent } from './mqtt.service';
import * as mqtt from 'mqtt';

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

  beforeEach(async () => {
    jest.clearAllMocks();
    mockMqttClient.connected = true; // Ensure connection is active by default
    process.env.MQTT_USERNAME = 'test_user';
    process.env.MQTT_PASSWORD = 'test_password';
    process.env.MQTT_HOST = 'localhost';
    process.env.MQTT_PORT = '1883';

    const module: TestingModule = await Test.createTestingModule({
      providers: [MqttService],
    }).compile();

    service = module.get<MqttService>(MqttService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Initialization and Connection', () => {
    it('should connect to MQTT broker on module init', () => {
      // Clear mocks to reset call count of mqtt.connect
      (mqtt.connect as jest.Mock).mockClear();

      service.onModuleInit();

      const expectedClientId = expect.stringContaining(
        'nestjs_backend_',
      ) as unknown as string;
      expect(mqtt.connect).toHaveBeenCalledWith('mqtt://localhost:1883', {
        username: 'test_user',
        password: 'test_password',
        clientId: expectedClientId,
        keepalive: 60,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
      });
      expect(mockMqttClient.on).toHaveBeenCalledWith(
        'connect',
        expect.any(Function),
      );
      expect(mockMqttClient.on).toHaveBeenCalledWith(
        'message',
        expect.any(Function),
      );
    });

    it('should log an error and not connect if credentials are missing', () => {
      delete process.env.MQTT_USERNAME;
      delete process.env.MQTT_BACKEND_USER;
      delete process.env.MQTT_PASSWORD;
      delete process.env.MQTT_BACKEND_PASS;

      // Clear mock calls to be sure
      (mqtt.connect as jest.Mock).mockClear();

      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});

      service.onModuleInit();

      expect(mqtt.connect).not.toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('MQTT_USERNAME and MQTT_PASSWORD must be set'),
      );
    });

    it('should subscribe to topics on connect', () => {
      let connectCallback: () => void = () => {};
      mockMqttClient.on.mockImplementation(
        (event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'connect') {
            connectCallback = cb;
          }
        },
      );

      service.onModuleInit();
      connectCallback();

      expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
        'mushroom/device/+/status',
        { qos: 1 },
        expect.any(Function),
      );
      expect(mockMqttClient.subscribe).toHaveBeenCalledWith(
        'mushroom/device/+/telemetry',
        { qos: 1 },
        expect.any(Function),
      );
    });
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

    it('should ignore message if topic is invalid', () => {
      const nextStatusSpy = jest.spyOn(service.deviceStatus$, 'next');
      const nextTelemetrySpy = jest.spyOn(service.telemetry$, 'next');

      messageCallback('invalid/topic', Buffer.from('payload'));
      messageCallback('mushroom/device/status', Buffer.from('payload')); // too short

      expect(nextStatusSpy).not.toHaveBeenCalled();
      expect(nextTelemetrySpy).not.toHaveBeenCalled();
    });

    it('should process online/offline device status correctly', (done) => {
      service.deviceStatus$.subscribe({
        next: (event: DeviceStatusEvent) => {
          expect(event.deviceId).toBe('device-1');
          expect(event.status).toBe('online');
          expect(event.timestamp).toBeDefined();

          const cached = service.getAllDeviceStatuses();
          expect(cached.length).toBe(1);
          expect(cached[0].deviceId).toBe('device-1');
          expect(cached[0].status).toBe('online');
          done();
        },
      });

      messageCallback(
        'mushroom/device/device-1/status',
        Buffer.from(JSON.stringify({ status: 'online' })),
      );
    });

    it('should warn and ignore unknown status values', () => {
      const nextStatusSpy = jest.spyOn(service.deviceStatus$, 'next');
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});

      messageCallback(
        'mushroom/device/device-1/status',
        Buffer.from(JSON.stringify({ status: 'unknown' })),
      );

      expect(nextStatusSpy).not.toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          "Received unknown status 'unknown' from device-1",
        ),
      );
    });

    it('should warn and ignore invalid JSON payload in status topic', () => {
      const nextStatusSpy = jest.spyOn(service.deviceStatus$, 'next');
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});

      messageCallback(
        'mushroom/device/device-1/status',
        Buffer.from('invalid-json'),
      );

      expect(nextStatusSpy).not.toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse MQTT message on topic'),
      );
    });

    it('should process telemetry event correctly', (done) => {
      service.telemetry$.subscribe({
        next: (event: TelemetryEvent) => {
          expect(event.deviceId).toBe('device-1');
          expect(event.temp_air).toBe(25.5);
          expect(event.humidity_air).toBe(82.3);
          expect(event.co2_level).toBe(650);
          expect(event.timestamp).toBeDefined();
          done();
        },
      });

      const telemetryPayload = {
        temp_air: 25.5,
        humidity_air: 82.3,
        co2_level: 650,
      };
      messageCallback(
        'mushroom/device/device-1/telemetry',
        Buffer.from(JSON.stringify(telemetryPayload)),
      );
    });

    it('should accept null values in telemetry if properties are missing or not numbers', (done) => {
      service.telemetry$.subscribe({
        next: (event: TelemetryEvent) => {
          expect(event.deviceId).toBe('device-1');
          expect(event.temp_air).toBeNull();
          expect(event.humidity_air).toBeNull();
          expect(event.co2_level).toBeNull();
          done();
        },
      });

      const telemetryPayload = {
        temp_air: 'not-a-number',
        humidity_air: null,
      };
      messageCallback(
        'mushroom/device/device-1/telemetry',
        Buffer.from(JSON.stringify(telemetryPayload)),
      );
    });

    it('should warn and ignore invalid telemetry payload (not an object)', () => {
      const nextTelemetrySpy = jest.spyOn(service.telemetry$, 'next');
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});

      messageCallback(
        'mushroom/device/device-1/telemetry',
        Buffer.from('null'),
      );

      expect(nextTelemetrySpy).not.toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Received invalid telemetry payload (not an object) from device-1',
        ),
      );
    });
  });

  describe('Publishing Setpoints and Commands', () => {
    beforeEach(() => {
      service.onModuleInit();
    });

    it('should publish raw payload correctly to setpoint topic', () => {
      const payload = { cmd: 'reset' };
      service.publish('device-1', payload);

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        'mushroom/device/device-1/setpoint',
        JSON.stringify(payload),
        { qos: 1 },
        expect.any(Function),
      );
    });

    it('should log an error if trying to publish when disconnected', () => {
      mockMqttClient.connected = false;
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});

      service.publish('device-1', { cmd: 'reset' });

      expect(loggerSpy).toHaveBeenCalledWith(
        'Cannot publish: MQTT client is not connected.',
      );
    });

    it('should dispatchSetpoint correctly with QoS 1', () => {
      const payload = {
        mist_generator_active: true,
        convection_fan_active: false,
        heating_lamp_active: true,
        midday_blackout_active: false,
      };

      service.dispatchSetpoint('device-1', payload);

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        'mushroom/device/device-1/setpoint',
        JSON.stringify(payload),
        { qos: 1 },
        expect.any(Function),
      );
    });

    it('should log an error if dispatchSetpoint is called when disconnected', () => {
      mockMqttClient.connected = false;
      const loggerSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});

      service.dispatchSetpoint('device-1', {
        mist_generator_active: true,
        convection_fan_active: false,
        heating_lamp_active: true,
        midday_blackout_active: false,
      });

      expect(loggerSpy).toHaveBeenCalledWith(
        'Cannot publish setpoint: MQTT client is not connected.',
      );
    });
  });
});
