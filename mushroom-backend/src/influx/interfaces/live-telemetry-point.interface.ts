export interface LiveTelemetryPoint {
  deviceId: string;
  timestamp: Date;
  dataQuality: 'good' | 'degraded' | 'missing_target';
  temperatureC: number;
  humidityPercent: number;
  tempTarget: number | null;
  humidTarget: number | null;
  controlSource: string | null;
  configRevision: number | null;
  mistState: boolean;
  lampState: boolean;
  fanState: boolean;
}
