export function validateSegment(segment: string): void {
  if (!segment || typeof segment !== 'string') {
    throw new Error('Topic segment must be a non-empty string');
  }
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(segment)) {
    throw new Error(
      `Invalid topic segment: "${segment}". Topic segments must contain only alphanumeric characters, underscores, or hyphens, and be 1-50 characters long to prevent injection.`
    );
  }
}

export function getTuningDesiredTopic(tenant: string, deviceId: string): string {
  validateSegment(tenant);
  validateSegment(deviceId);
  return `${tenant}/esp32/${deviceId}/down/tuning/desired`;
}

export function getTuningReportedTopic(tenant: string, deviceId: string): string {
  validateSegment(tenant);
  validateSegment(deviceId);
  return `${tenant}/esp32/${deviceId}/up/tuning/reported`;
}

export function getTuningReportedPattern(tenant: string): string {
  validateSegment(tenant);
  return `${tenant}/esp32/+/up/tuning/reported`;
}
