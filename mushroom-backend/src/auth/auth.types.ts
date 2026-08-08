import { UserRole } from './entities/user.entity';

export interface AuthPrincipal {
  id: string;
  /** Vietnamese phone number in E.164 format, e.g. +84901234567 */
  phoneNumber: string;
  fullName?: string | null;
  avatar?: string | null;
  role: UserRole;
  houseIds: string[];
  sessionId: string;
  /** True when the user must set a new PIN before accessing protected routes */
  mustSetPin: boolean;
}

export const SESSION_COOKIE_NAME =
  process.env.AUTH_SESSION_COOKIE_NAME?.trim() || 'sid';
/** 30 days — farmers should not need to re-login frequently */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** 7 days idle — session stays alive if app is opened at least once a week */
export const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/** Number of consecutive failed PIN attempts before temporary lockout for primary password login */
export const PIN_MAX_ATTEMPTS = 5;
/** Lockout duration after exceeding PIN_MAX_ATTEMPTS */
export const PIN_LOCKOUT_MS = 15 * 60 * 1000;

/** Number of consecutive failed PIN attempts on a kiosk tablet before per-device lockout */
export const KIOSK_PIN_MAX_ATTEMPTS = 3;
/** Per-device lockout duration after exceeding KIOSK_PIN_MAX_ATTEMPTS */
export const KIOSK_PIN_LOCKOUT_MS = 15 * 60 * 1000;
/** Maximum active device PIN bindings allowed per user */
export const MAX_DEVICES_PER_USER = 5;
