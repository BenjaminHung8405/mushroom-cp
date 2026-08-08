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
      errorMsg = data.message || errorMsg;
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
  async listUsers(): Promise<AdminUser[]> {
    return fetchJson<AdminUser[]>(`${API_BASE}/admin/users`);
  },

  async createUser(payload: CreateUserPayload): Promise<AdminUser> {
    return fetchJson<AdminUser>(`${API_BASE}/admin/users`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateUser(id: string, payload: UpdateUserPayload): Promise<AdminUser> {
    return fetchJson<AdminUser>(`${API_BASE}/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async resetPin(id: string, pin: string): Promise<void> {
    await fetchJson<void>(`${API_BASE}/admin/users/${id}/reset-pin`, {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  },

  async setHouseAccess(id: string, houseIds: string[]): Promise<void> {
    await fetchJson<void>(`${API_BASE}/admin/users/${id}/house-access`, {
      method: 'PUT',
      body: JSON.stringify({ houseIds }),
    });
  },

  // Houses
  async listHouses(): Promise<PaginatedResponse<AdminHouse>> {
    return fetchJson<PaginatedResponse<AdminHouse>>(`${API_BASE}/admin/houses`);
  },

  async createHouse(payload: CreateHousePayload): Promise<AdminHouse> {
    return fetchJson<AdminHouse>(`${API_BASE}/admin/houses`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateHouse(id: string, payload: UpdateHousePayload): Promise<AdminHouse> {
    return fetchJson<AdminHouse>(`${API_BASE}/admin/houses/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async deleteHouse(id: string): Promise<{ message: string }> {
    return fetchJson<{ message: string }>(`${API_BASE}/admin/houses/${id}`, {
      method: 'DELETE',
    });
  },

  // Devices
  async listDevices(): Promise<PaginatedResponse<AdminDevice>> {
    return fetchJson<PaginatedResponse<AdminDevice>>(`${API_BASE}/admin/devices`);
  },

  async createDevice(payload: CreateDevicePayload): Promise<AdminDevice & { rawToken: string }> {
    return fetchJson<AdminDevice & { rawToken: string }>(`${API_BASE}/admin/devices`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateDevice(id: string, payload: UpdateDevicePayload): Promise<AdminDevice> {
    return fetchJson<AdminDevice>(`${API_BASE}/admin/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async regenerateDeviceToken(id: string): Promise<{ deviceId: string; rawToken: string }> {
    return fetchJson<{ deviceId: string; rawToken: string }>(
      `${API_BASE}/admin/devices/${id}/token/regenerate`,
      { method: 'POST' },
    );
  },
};
