import { Injectable } from '@nestjs/common';

export interface AnalyticsAvailability {
  available: boolean;
  reason: string | null;
}

/** Shared fail-closed readiness state for the optional Influx KPI subsystem. */
@Injectable()
export class AnalyticsAvailabilityService {
  private state: AnalyticsAvailability = {
    available: false,
    reason: 'INFLUX_ANALYTICS_NOT_READY',
  };

  markAvailable(): void {
    this.state = { available: true, reason: null };
  }

  markUnavailable(reason: string): void {
    this.state = { available: false, reason };
  }

  getState(): AnalyticsAvailability {
    return { ...this.state };
  }
}
