import { kioskStorage } from './kiosk-storage';

export interface AuthUser {
  id: string;
  phoneNumber: string;
  fullName?: string | null;
  avatar?: string | null;
  role: 'ADMIN' | 'OPERATOR' | 'AUDITOR';
  houseIds: string[];
  mustSetPin: boolean;
}

/** Derive a short human-readable device label from navigator.userAgent. */
function labelFromUserAgent(ua: string): string {
  if (!ua) return 'Unknown Device';
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\//.test(ua) ? 'Opera' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os =
    /iPad/.test(ua) ? 'iPad' :
    /iPhone/.test(ua) ? 'iPhone' :
    /Android/.test(ua) ? 'Android Tablet' :
    /Windows/.test(ua) ? 'Windows' :
    /Macintosh/.test(ua) ? 'Mac' :
    /Linux/.test(ua) ? 'Linux' : 'Device';
  return `${browser} on ${os}`.slice(0, 150);
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  });

  if (!res.ok) {
    let errorMsg = 'Yêu cầu không thành công';
    try {
      const data = await res.json();
      errorMsg = data.message || errorMsg;
    } catch {
      // ignore json parse error
    }
    throw new Error(errorMsg);
  }

  if (res.status === 204) {
    return {} as T;
  }

  return res.json();
}

export const authApi = {
  async login(phoneNumber: string, pin: string): Promise<{ user: AuthUser }> {
    // Silently include the kiosk device token (if available) so the backend
    // can auto-register this device in a single round-trip.
    let deviceToken: string | undefined;
    let deviceLabel: string | undefined;
    try {
      deviceToken = typeof window !== 'undefined' ? kioskStorage.getDeviceToken() : undefined;
      if (deviceToken && typeof navigator !== 'undefined') {
        deviceLabel = labelFromUserAgent(navigator.userAgent);
      }
    } catch {
      // Not a kiosk browser (SSR or getDeviceToken threw) — skip device registration
    }
    return fetchJson<{ user: AuthUser }>(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ phoneNumber, pin, deviceToken, deviceLabel }),
    });
  },

  async me(): Promise<AuthUser | null> {
    try {
      return await fetchJson<AuthUser>(`${API_BASE}/auth/me`, { method: 'GET' });
    } catch {
      return null;
    }
  },

  async logout(): Promise<void> {
    await fetchJson<void>(`${API_BASE}/auth/logout`, { method: 'POST' });
  },

  async updateProfile(dto: { fullName?: string; avatar?: string }): Promise<AuthUser> {
    return fetchJson<AuthUser>(`${API_BASE}/auth/profile`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    });
  },

  async pinLogin(phoneNumber: string, pin: string, deviceToken: string): Promise<{ user: AuthUser }> {
    return fetchJson<{ user: AuthUser }>(`${API_BASE}/auth/pin/login`, {
      method: 'POST',
      body: JSON.stringify({ phoneNumber, pin, deviceToken }),
    });
  },

  // pinSetup() removed — device registration now happens automatically
  // inside login() by sending deviceToken + deviceLabel to POST /auth/login.

  async setPin(currentPin: string, newPin: string): Promise<void> {
    await fetchJson<void>(`${API_BASE}/auth/set-pin`, {
      method: 'POST',
      body: JSON.stringify({ currentPin, newPin }),
    });
  },

  async pinRevoke(deviceToken: string): Promise<void> {
    await fetchJson<void>(`${API_BASE}/auth/pin/device`, {
      method: 'DELETE',
      headers: {
        'x-device-token': deviceToken,
      },
    });
  },
};
