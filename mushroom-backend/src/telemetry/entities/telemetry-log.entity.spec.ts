import { TelemetryLog } from './telemetry-log.entity';

describe('TelemetryLog Entity', () => {
  it('should create a TelemetryLog instance', () => {
    const log = new TelemetryLog();
    const now = new Date();
    log.time = now;
    log.batchId = 'batch-123';
    log.houseId = 'house-123';
    log.cropDayInt = 5;
    log.humidityMeasured = 85.5;
    log.temperatureMeasured = 29.4;
    log.co2Measured = 800;
    log.humiditySetpoint = 85.0;
    log.temperatureSetpoint = 29.0;
    log.humidityErrorDelta = -0.5;
    log.temperatureErrorDelta = -0.4;
    log.mistGeneratorActive = true;
    log.convectionFanActive = false;
    log.heatingLampActive = true;
    log.middayBlackoutActive = false;

    expect(log).toBeDefined();
    expect(log.time).toBe(now);
    expect(log.batchId).toBe('batch-123');
    expect(log.houseId).toBe('house-123');
    expect(log.cropDayInt).toBe(5);
    expect(log.humidityMeasured).toBe(85.5);
    expect(log.temperatureMeasured).toBe(29.4);
    expect(log.co2Measured).toBe(800);
    expect(log.humiditySetpoint).toBe(85.0);
    expect(log.temperatureSetpoint).toBe(29.0);
    expect(log.humidityErrorDelta).toBe(-0.5);
    expect(log.temperatureErrorDelta).toBe(-0.4);
    expect(log.mistGeneratorActive).toBe(true);
    expect(log.convectionFanActive).toBe(false);
    expect(log.heatingLampActive).toBe(true);
    expect(log.middayBlackoutActive).toBe(false);
  });
});
