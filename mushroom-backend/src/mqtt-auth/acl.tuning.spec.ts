import { MqttAuthService } from './mqtt-auth.service';

describe('MQTT ACL Tuning Security Regression Tests', () => {
  let service: MqttAuthService;

  beforeEach(() => {
    process.env.MQTT_BOOTSTRAP_USER = 'provision_node';
    process.env.MQTT_BOOTSTRAP_SECRET = 'bootstrap-secret';
    process.env.MQTT_BACKEND_USER = 'nestjs_backend';
    process.env.MQTT_BACKEND_PASS = 'backend-secret';
    process.env.IOT_TENANT = 'mushroom';
    service = new MqttAuthService(null as never);
  });

  describe('Backend superuser access', () => {
    it('allows backend to publish desired topic for any device', () => {
      expect(
        service.authorize({
          username: 'nestjs_backend',
          clientid: 'mushroom_backend',
          topic: 'mushroom/esp32/device1/down/tuning/desired',
          acc: 2, // write
        }),
      ).toBe(true);

      expect(
        service.authorize({
          username: 'nestjs_backend',
          clientid: 'mushroom_backend',
          topic: 'mushroom/esp32/device2/down/tuning/desired',
          acc: 2, // write
        }),
      ).toBe(true);
    });

    it('allows backend to subscribe/read reported topic for any device', () => {
      expect(
        service.authorize({
          username: 'nestjs_backend',
          clientid: 'mushroom_backend',
          topic: 'mushroom/esp32/device1/up/tuning/reported',
          acc: 1, // read
        }),
      ).toBe(true);

      expect(
        service.authorize({
          username: 'nestjs_backend',
          clientid: 'mushroom_backend',
          topic: 'mushroom/esp32/device2/up/tuning/reported',
          acc: 4, // subscribe
        }),
      ).toBe(true);
    });
  });

  describe('Device access', () => {
    it('allows device to read its own desired topic', () => {
      expect(
        service.authorize({
          username: 'device1',
          clientid: 'device1',
          topic: 'mushroom/esp32/device1/down/tuning/desired',
          acc: 1, // read
        }),
      ).toBe(true);

      expect(
        service.authorize({
          username: 'device1',
          clientid: 'device1',
          topic: 'mushroom/esp32/device1/down/tuning/desired',
          acc: 4, // subscribe
        }),
      ).toBe(true);
    });

    it('denies device from publishing to its own desired topic', () => {
      expect(
        service.authorize({
          username: 'device1',
          clientid: 'device1',
          topic: 'mushroom/esp32/device1/down/tuning/desired',
          acc: 2, // write
        }),
      ).toBe(false);

      expect(
        service.authorize({
          username: 'device1',
          clientid: 'device1',
          topic: 'mushroom/esp32/device1/down/tuning/desired',
          acc: 3, // read/write
        }),
      ).toBe(false);
    });

    it('allows device to publish to its own reported topic', () => {
      expect(
        service.authorize({
          username: 'device1',
          clientid: 'device1',
          topic: 'mushroom/esp32/device1/up/tuning/reported',
          acc: 2, // write
        }),
      ).toBe(true);
    });

    it('denies device from subscribing/reading its own reported topic', () => {
      expect(
        service.authorize({
          username: 'device1',
          clientid: 'device1',
          topic: 'mushroom/esp32/device1/up/tuning/reported',
          acc: 1, // read
        }),
      ).toBe(false);

      expect(
        service.authorize({
          username: 'device1',
          clientid: 'device1',
          topic: 'mushroom/esp32/device1/up/tuning/reported',
          acc: 4, // subscribe
        }),
      ).toBe(false);
    });

    it('denies device from publishing reported of other devices', () => {
      expect(
        service.authorize({
          username: 'device1',
          clientid: 'device1',
          topic: 'mushroom/esp32/device2/up/tuning/reported',
          acc: 2, // write
        }),
      ).toBe(false);
    });

    it('denies device from reading desired of other devices', () => {
      expect(
        service.authorize({
          username: 'device1',
          clientid: 'device1',
          topic: 'mushroom/esp32/device2/down/tuning/desired',
          acc: 1, // read
        }),
      ).toBe(false);
    });

    it('denies unmatched downlink writes and uplink reads by default', () => {
      expect(service.authorize({
        username: 'device1', clientid: 'device1',
        topic: 'mushroom/esp32/device1/down/command', acc: 2,
      })).toBe(false);
      expect(service.authorize({
        username: 'device1', clientid: 'device1',
        topic: 'mushroom/esp32/device1/down/tuning/desired', acc: 2,
      })).toBe(false);
      expect(service.authorize({
        username: 'device1', clientid: 'device1',
        topic: 'mushroom/esp32/device1/up/telemetry', acc: 1,
      })).toBe(false);
      expect(service.authorize({
        username: 'device1', clientid: 'device1',
        topic: 'mushroom/esp32/device1/up/tuning/reported', acc: 1,
      })).toBe(false);
    });
  });

  describe('Wildcard and Injection Protection', () => {
    it('denies devices from using wildcard topic subscription/publish', () => {
      // Wildcard in topic
      expect(
        service.authorize({
          username: 'device1',
          clientid: 'device1',
          topic: 'mushroom/esp32/+/down/tuning/desired',
          acc: 1,
        }),
      ).toBe(false);

      expect(
        service.authorize({
          username: 'device1',
          clientid: 'device1',
          topic: 'mushroom/esp32/#',
          acc: 1,
        }),
      ).toBe(false);

      // Wildcard in username / clientId
      expect(
        service.authorize({
          username: 'device+',
          clientid: 'device+',
          topic: 'mushroom/esp32/device+/down/tuning/desired',
          acc: 1,
        }),
      ).toBe(false);
    });

    it('denies access if tenant segment does not match configured tenant', () => {
      expect(
        service.authorize({
          username: 'device1',
          clientid: 'device1',
          topic: 'other_tenant/esp32/device1/down/tuning/desired',
          acc: 1,
        }),
      ).toBe(false);
    });
  });
});
