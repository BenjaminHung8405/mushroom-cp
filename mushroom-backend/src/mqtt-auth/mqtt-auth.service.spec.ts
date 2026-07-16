import { TooManyRequestsException } from '@nestjs/common';
import { MqttAuthService } from './mqtt-auth.service';

describe('MqttAuthService', () => {
  const repo = { findOne: jest.fn() };
  let service: MqttAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MQTT_BOOTSTRAP_USER = 'provision_node';
    process.env.MQTT_BOOTSTRAP_SECRET = 'bootstrap-secret';
    process.env.MQTT_BACKEND_USER = 'nestjs_backend';
    process.env.MQTT_BACKEND_PASS = 'backend-secret';
    process.env.IOT_TENANT = 'mushroom';
    service = new MqttAuthService(repo as never);
  });

  it('authenticates the bootstrap credential only when it matches', async () => {
    await expect(service.authenticate({ username: 'provision_node', password: 'bootstrap-secret', clientid: 'aabbccddeeff' })).resolves.toBe(true);
    await expect(service.authenticate({ username: 'provision_node', password: 'wrong', clientid: 'aabbccddeeff' })).resolves.toBe(false);
  });

  it('authenticates an enabled device only when its client id and token match', async () => {
    repo.findOne.mockResolvedValue({ enabled: true, token: 'device-token' });
    await expect(service.authenticate({ username: 'mushroom_s3_aabbccddeeff', clientid: 'mushroom_s3_aabbccddeeff', password: 'device-token' })).resolves.toBe(true);
    await expect(service.authenticate({ username: 'mushroom_s3_aabbccddeeff', clientid: 'other', password: 'device-token' })).resolves.toBe(false);
  });

  it('authenticates the backend using its dedicated credentials', async () => {
    await expect(service.authenticate({
      username: 'nestjs_backend',
      password: 'backend-secret',
      clientid: 'mushroom_backend',
    })).resolves.toBe(true);
    await expect(service.authenticate({
      username: 'nestjs_backend',
      password: 'wrong',
      clientid: 'mushroom_backend',
    })).resolves.toBe(false);
  });

  it('enforces bootstrap and device ACL boundaries', () => {
    expect(service.authorize({ username: 'provision_node', clientid: 'aabbccddeeff', topic: 'mushroom/provision/request', acc: 2 })).toBe(true);
    expect(service.authorize({ username: 'provision_node', clientid: 'aabbccddeeff', topic: 'mushroom/provision/response/aabbccddeeff', acc: 1 })).toBe(true);
    expect(service.authorize({ username: 'provision_node', clientid: 'aabbccddeeff', topic: 'mushroom/esp32/other/up/telemetry', acc: 2 })).toBe(false);
    expect(service.authorize({ username: 'mushroom_s3_aabbccddeeff', clientid: 'mushroom_s3_aabbccddeeff', topic: 'mushroom/esp32/mushroom_s3_aabbccddeeff/up/telemetry', acc: 2 })).toBe(true);
  });

  it('limits provisioning requests independently per MAC', () => {
    for (let i = 0; i < 5; i += 1) service.enforceProvisionRateLimit('aabbccddeeff');
    expect(() => service.enforceProvisionRateLimit('aabbccddeeff')).toThrow(TooManyRequestsException);
  });
});
