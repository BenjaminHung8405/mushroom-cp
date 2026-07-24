import { DeviceHealthService, HealthState } from './device-health.service';
import type { DeviceRecord } from '../device/device-registry.service';

const device: DeviceRecord = {
  deviceId: 'device-1',
  houseId: 'house-1',
  enabled: true,
  displayName: null,
  mqttUsername: 'device-1',
  lastSeenAt: null,
};

describe('DeviceHealthService', () => {
  let service: DeviceHealthService;
  beforeEach(() => {
    service = new DeviceHealthService();
  });
  afterEach(() => service.onModuleDestroy());

  it('uses boot grace for online LWT before telemetry arrives', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    service.handleLwtStatus(device, 'online', now);
    service.evaluateGlobalHealthStates(new Date(now.getTime() + 45_001));
    expect(service.getHealth(device.deviceId)).toBe(
      HealthState.DEGRADED_LATENCY,
    );
  });

  it('transitions at the active, degraded, and fault thresholds', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    service.handleTelemetryReceived(device, now);
    service.evaluateGlobalHealthStates(new Date(now.getTime() + 45_000));
    expect(service.getHealth(device.deviceId)).toBe(HealthState.ONLINE_ACTIVE);
    service.evaluateGlobalHealthStates(new Date(now.getTime() + 45_001));
    expect(service.getHealth(device.deviceId)).toBe(
      HealthState.DEGRADED_LATENCY,
    );
    service.evaluateGlobalHealthStates(new Date(now.getTime() + 120_001));
    expect(service.getHealth(device.deviceId)).toBe(HealthState.SENSOR_FAULT);
  });

  it('offline has priority and blocks commands', () => {
    const now = new Date();
    service.handleTelemetryReceived(device, now);
    service.handleLwtStatus(device, 'offline', now);
    service.evaluateGlobalHealthStates(new Date(now.getTime() + 999_999));
    expect(service.getHealth(device.deviceId)).toBe(HealthState.OFFLINE);
    expect(service.isCommandAllowed(device.deviceId)).toBe(false);
  });

  it('does not cache disabled records', () => {
    service.handleTelemetryReceived({ ...device, enabled: false });
    expect(service.getHealth(device.deviceId)).toBe(HealthState.UNKNOWN);
  });
});
