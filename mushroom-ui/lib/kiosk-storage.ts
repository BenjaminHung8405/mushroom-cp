export interface KioskRegisteredUser {
  userId: string;
  phoneNumber: string;
  displayName: string;
  registeredAt: number;
}

const STORAGE_KEYS = {
  DEVICE_TOKEN: 'kiosk_device_token',
  REGISTERED_USERS: 'kiosk_registered_users',
} as const;

export function maskPhoneNumber(phone: string): string {
  const clean = phone.replace(/^\+84/, '0').trim();
  if (clean.length < 9) return clean;
  return `${clean.slice(0, 3)}••••${clean.slice(-3)}`;
}

export function generateAvatarGradient(identifier: string): string {
  let hash = 0;
  for (let i = 0; i < identifier.length; i++) {
    hash = identifier.charCodeAt(i) + ((hash << 5) - hash);
  }

  const gradients = [
    'from-emerald-600 to-teal-800',
    'from-blue-600 to-indigo-800',
    'from-violet-600 to-purple-800',
    'from-amber-600 to-orange-800',
    'from-rose-600 to-pink-800',
    'from-cyan-600 to-blue-800',
  ];

  const index = Math.abs(hash) % gradients.length;
  return gradients[index];
}

export const kioskStorage = {
  getDeviceToken(): string {
    if (typeof window === 'undefined') return '';
    let token = localStorage.getItem(STORAGE_KEYS.DEVICE_TOKEN);
    if (!token) {
      token = crypto.randomUUID();
      localStorage.setItem(STORAGE_KEYS.DEVICE_TOKEN, token);
    }
    return token;
  },

  getRegisteredUsers(): KioskRegisteredUser[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  addRegisteredUser(user: { userId: string; phoneNumber: string }): void {
    if (typeof window === 'undefined') return;
    const users = kioskStorage.getRegisteredUsers();
    const existingIdx = users.findIndex((u) => u.userId === user.userId);
    const entry: KioskRegisteredUser = {
      userId: user.userId,
      phoneNumber: user.phoneNumber,
      displayName: maskPhoneNumber(user.phoneNumber),
      registeredAt: Date.now(),
    };

    if (existingIdx !== -1) {
      users[existingIdx] = entry;
    } else {
      users.push(entry);
    }

    localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(users));
  },

  removeRegisteredUser(userId: string): void {
    if (typeof window === 'undefined') return;
    const users = kioskStorage.getRegisteredUsers().filter((u) => u.userId !== userId);
    localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(users));
  },
};
