import { UserRole } from './entities/user.entity';

export interface AuthPrincipal {
  id: string;
  email: string;
  role: UserRole;
  houseIds: string[];
  sessionId: string;
  mustChangePassword: boolean;
}

export const SESSION_COOKIE_NAME = process.env.AUTH_SESSION_COOKIE_NAME?.trim() || 'sid';
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
