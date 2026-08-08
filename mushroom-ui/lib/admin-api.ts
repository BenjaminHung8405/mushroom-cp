export interface AdminUser {
  id: string;
  phoneNumber: string;
  role: 'ADMIN' | 'OPERATOR' | 'AUDITOR';
  isActive: boolean;
  mustSetPin: boolean;
  pinLockedUntil: string | null;
  createdAt: string;
}

export interface AdminHouse {
  id: string;
  name: string;
  areaMeters: string;
  pillarCount: number;
  createdAt: string;
  deviceCount: number;
  activeUserCount: number;
}

export interface AdminDevice {
  deviceId: string;
  displayName: string | null;
  houseId: string;
  houseName: string;
  ownerUserId: string;
  ownerPhone: string;
  enabled: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  onlineStatus: 'online' | 'offline' | 'unconnected';
}

export interface CreateUserPayload {
  phoneNumber: string;
  pin: string;
  role: 'ADMIN' | 'OPERATOR' | 'AUDITOR';
}

export interface UpdateUserPayload {
  role?: 'ADMIN' | 'OPERATOR' | 'AUDITOR';
  isActive?: boolean;
  phoneNumber?: string;
  newPin?: string;
}

export interface CreateHousePayload {
  id: string;
  name: string;
  areaMeters?: string;
  pillarCount?: number;
}

export interface UpdateHousePayload {
  name?: string;
  areaMeters?: string;
  pillarCount?: number;
}

export interface CreateDevicePayload {
  deviceId: string;
  houseId: string;
  ownerUserId?: string;
  displayName?: string;
}

export interface UpdateDevicePayload {
  displayName?: string;
  houseId?: string;
  ownerUserId?: string;
  enabled?: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
  };
}

const API_BASE = '/api/backend';

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
      if (Array.isArray(data.message)) {
        errorMsg = data.message.join('; ');
      } else if (typeof data.message === 'string' && data.message.trim()) {
        errorMsg = data.message;
      } else if (typeof data.error === 'string' && data.error.trim()) {
        errorMsg = data.error;
      }
    } catch {
      // ignore parse error
    }
    throw new Error(errorMsg);
  }

  if (res.status === 204) {
    return {} as T;
  }

  return res.json();
}

export const adminApi = {
  // Users
  async listUsers(signal?: AbortSignal): Promise<AdminUser[]> {
    return fetchJson<AdminUser[]>(`${API_BASE}/admin/users`, { signal });
  },

  async createUser(payload: CreateUserPayload, signal?: AbortSignal): Promise<AdminUser> {
    return fetchJson<AdminUser>(`${API_BASE}/admin/users`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    });
  },

  async updateUser(id: string, payload: UpdateUserPayload, signal?: AbortSignal): Promise<AdminUser> {
    return fetchJson<AdminUser>(`${API_BASE}/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      signal,
    });
  },

  async resetPin(id: string, pin: string, signal?: AbortSignal): Promise<void> {
    await fetchJson<void>(`${API_BASE}/admin/users/${id}/reset-pin`, {
      method: 'POST',
      body: JSON.stringify({ pin }),
      signal,
    });
  },

  async setHouseAccess(id: string, houseIds: string[], signal?: AbortSignal): Promise<void> {
    await fetchJson<void>(`${API_BASE}/admin/users/${id}/house-access`, {
      method: 'PUT',
      body: JSON.stringify({ houseIds }),
      signal,
    });
  },

  // Houses
  async listHouses(signal?: AbortSignal): Promise<PaginatedResponse<AdminHouse>> {
    return fetchJson<PaginatedResponse<AdminHouse>>(`${API_BASE}/admin/houses`, { signal });
  },

  async createHouse(payload: CreateHousePayload, signal?: AbortSignal): Promise<AdminHouse> {
    return fetchJson<AdminHouse>(`${API_BASE}/admin/houses`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    });
  },

  async updateHouse(id: string, payload: UpdateHousePayload, signal?: AbortSignal): Promise<AdminHouse> {
    return fetchJson<AdminHouse>(`${API_BASE}/admin/houses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      signal,
    });
  },

  async deleteHouse(id: string, signal?: AbortSignal): Promise<{ message: string }> {
    return fetchJson<{ message: string }>(`${API_BASE}/admin/houses/${id}`, {
      method: 'DELETE',
      signal,
    });
  },

  // Devices
  async listDevices(signal?: AbortSignal): Promise<PaginatedResponse<AdminDevice>> {
    return fetchJson<PaginatedResponse<AdminDevice>>(`${API_BASE}/admin/devices`, { signal });
  },

  async createDevice(payload: CreateDevicePayload, signal?: AbortSignal): Promise<AdminDevice & { rawToken: string }> {
    return fetchJson<AdminDevice & { rawToken: string }>(`${API_BASE}/admin/devices`, {
      method: 'POST',
      body: JSON.stringify(payload),
      signal,
    });
  },

  async updateDevice(id: string, payload: UpdateDevicePayload, signal?: AbortSignal): Promise<AdminDevice> {
    return fetchJson<AdminDevice>(`${API_BASE}/admin/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
      signal,
    });
  },

  async regenerateDeviceToken(id: string, signal?: AbortSignal): Promise<{ deviceId: string; rawToken: string }> {
    return fetchJson<{ deviceId: string; rawToken: string }>(
      `${API_BASE}/admin/devices/${id}/token/regenerate`,
      { method: 'POST', signal },
    );
  },
};
