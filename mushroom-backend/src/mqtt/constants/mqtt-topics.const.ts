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

export type TuningTopicKind = 'desired' | 'reported';

export interface TuningTopicMatch {
  tenant: string;
  deviceId: string;
  kind: TuningTopicKind;
}

/** Parses only the exact v1 tuning topic contract. */
export function parseTuningTopic(topic: string): TuningTopicMatch | null {
  const parts = topic.split('/');
  if (parts.length !== 6 || parts[1] !== 'esp32' || parts[3] !== 'down' && parts[3] !== 'up') {
    return null;
  }
  const isDesired = parts[3] === 'down' && parts[4] === 'tuning' && parts[5] === 'desired';
  const isReported = parts[3] === 'up' && parts[4] === 'tuning' && parts[5] === 'reported';
  if (!isDesired && !isReported) return null;
  try {
    validateSegment(parts[0]);
    validateSegment(parts[2]);
  } catch {
    return null;
  }
  return { tenant: parts[0], deviceId: parts[2], kind: isDesired ? 'desired' : 'reported' };
}
