/** Immutable v1 tuning contract. Keep synchronized with firmware bounds. */
export const LAMP_GAIN_SCALE_MIN = 0.8;
export const LAMP_GAIN_SCALE_MAX = 1.2;
export const MIST_GAIN_SCALE_MIN = 0.8;
export const MIST_GAIN_SCALE_MAX = 1.2;
export const MIST_ON_THRESHOLD_MIN = 0.2;
export const MIST_ON_THRESHOLD_MAX = 0.35;
export const MIST_OFF_THRESHOLD_MIN = 0.1;
export const MIST_OFF_THRESHOLD_MAX = 0.2;
export const MIN_THRESHOLD_GAP = 0.001;

/** Stable values emitted by firmware's tuningReasonCode(). */
export const TUNING_REJECTION_REASON_CODES = [
  'INVALID_SCHEMA',
  'DEVICE_MISMATCH',
  'INVALID_UUID',
  'OUT_OF_RANGE',
  'CROSS_FIELD_INVALID',
  'PERSISTENCE_FAILED',
  'CONTROL_QUEUE_UNAVAILABLE',
  'STALE_REVISION',
] as const;

export type TuningRejectionReasonCode =
  (typeof TUNING_REJECTION_REASON_CODES)[number];

/** Matches the durable rejection_reason VARCHAR(64) column. */
export const MAX_TUNING_REJECTION_REASON_CODE_LENGTH = 64;

export function isTuningRejectionReasonCode(
  value: unknown,
): value is TuningRejectionReasonCode {
  return (
    typeof value === 'string' &&
    value.length <= MAX_TUNING_REJECTION_REASON_CODE_LENGTH &&
    TUNING_REJECTION_REASON_CODES.includes(value as TuningRejectionReasonCode)
  );
}
