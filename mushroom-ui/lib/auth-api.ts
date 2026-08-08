export interface AuthUser {
  id: string;
  phoneNumber: string;
  role: 'ADMIN' | 'OPERATOR' | 'AUDITOR';
  houseIds: string[];
  mustSetPin: boolean;
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
    return fetchJson<{ user: AuthUser }>(`${API_BASE}/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ phoneNumber, pin }),
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

  async pinLogin(phoneNumber: string, pin: string, deviceToken: string): Promise<{ user: AuthUser }> {
    return fetchJson<{ user: AuthUser }>(`${API_BASE}/auth/pin/login`, {
      method: 'POST',
      body: JSON.stringify({ phoneNumber, pin, deviceToken }),
    });
  },

  async pinSetup(currentPin: string, newPinForDevice: string, deviceToken: string, deviceLabel?: string): Promise<void> {
    await fetchJson<void>(`${API_BASE}/auth/pin/setup`, {
      method: 'POST',
      body: JSON.stringify({ currentPin, newPinForDevice, deviceToken, deviceLabel }),
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
