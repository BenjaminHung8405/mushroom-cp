const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

/**
 * Returns the current time in Vietnam as minutes since midnight.
 * Formatting in a named timezone avoids relying on the browser or Docker host
 * timezone when evaluating biological blackout windows.
 */
export function vietnamMinutesSinceMidnight(dateInput: Date | string = new Date()): number {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
  if (Number.isNaN(date.getTime())) return Number.NaN

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIME_ZONE,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)

  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  return hour * 60 + minute
}

/**
 * Biological rule for mist and hot-water controls: only the two short windows
 * below are safe. The ESP32 remains the final authority; this is UI feedback.
 */
export function isMistingAllowed(dateInput: Date | string = new Date()): boolean {
  const currentMinutes = vietnamMinutesSinceMidnight(dateInput)
  const morningWindow = currentMinutes >= 6 * 60 + 1 && currentMinutes <= 7 * 60 + 59
  const afternoonWindow = currentMinutes >= 16 * 60 + 1 && currentMinutes <= 17 * 60 + 59
  return morningWindow || afternoonWindow
}

export function mistingLockReason(dateInput: Date | string = new Date()): string {
  return isMistingAllowed(dateInput)
    ? ''
    : 'Chỉ được phép 06:01–07:59 hoặc 16:01–17:59 (giờ Việt Nam)'
}
