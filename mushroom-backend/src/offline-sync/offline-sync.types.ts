/** The Phase 3 device topic carries a concatenated sequence of 18-byte records. */
export const OFFLINE_TELEMETRY_STRUCT_BYTES = 18;

export interface OfflineTelemetryStruct {
  bootCount: number;
  deltaTimeS: number;
  temp: number;
  humid: number;
  mistState: boolean;
  lampState: boolean;
}

export interface OfflineSyncIngestionSummary {
  deviceId: string;
  recordsReceived: number;
  currentBootCount: number | null;
  trustedRecords: number;
  degradedRecords: number;
}
