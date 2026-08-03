import { Injectable } from '@nestjs/common';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const TUNING_TIMEZONE = 'Asia/Ho_Chi_Minh' as const;

export interface ObservationWindow {
  observationDate: string;
  from: Date;
  to: Date;
  timezone: typeof TUNING_TIMEZONE;
}

@Injectable()
export class TuningObservationClockService {
  getCompletedDay(now: Date = new Date()): ObservationWindow {
    const today = formatInTimeZone(now, TUNING_TIMEZONE, 'yyyy-MM-dd');
    const to = fromZonedTime(`${today}T00:00:00`, TUNING_TIMEZONE);
    const observationDate = formatInTimeZone(
      new Date(to.getTime() - 1),
      TUNING_TIMEZONE,
      'yyyy-MM-dd',
    );
    return {
      observationDate,
      from: fromZonedTime(`${observationDate}T00:00:00`, TUNING_TIMEZONE),
      to,
      timezone: TUNING_TIMEZONE,
    };
  }

  getCurrentObservationDate(now: Date = new Date()): string {
    return this.getCompletedDay(now).observationDate;
  }
}
