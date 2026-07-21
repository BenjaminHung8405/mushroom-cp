export interface LiveTelemetryPoint {
  deviceId: string;
  timestamp: Date;
  dataQuality: 'good' | 'degraded' | 'missing_target';
  temperatureC: number | null;
  humidityPercent: number | null;
  tempTarget: number | null;
  humidTarget: number | null;
  controlSource: string | null;
  configRevision: number | null;
  mistState: boolean | null;
  lampState: boolean | null;
  fanState: boolean | null;
}
