'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi, type AuthUser } from './auth-api';
import { kioskStorage } from './kiosk-storage';

interface AuthContextType {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  login: (phone: string, pin: string) => Promise<AuthUser>;
  pinLogin: (phone: string, pin: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  const refresh = useCallback(async () => {
    try {
      const me = await authApi.me();
      if (me) {
        setUser(me);
        setStatus('authenticated');
      } else {
        setUser(null);
        setStatus('unauthenticated');
      }
    } catch {
      setUser(null);
      setStatus('unauthenticated');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = async (phone: string, pin: string): Promise<AuthUser> => {
    const res = await authApi.login(phone, pin);
    setUser(res.user);
    setStatus('authenticated');
    return res.user;
  };

  const pinLogin = async (phone: string, pin: string): Promise<AuthUser> => {
    const deviceToken = kioskStorage.getDeviceToken();
    const res = await authApi.pinLogin(phone, pin, deviceToken);
    setUser(res.user);
    setStatus('authenticated');
    // Save to kiosk registered users
    kioskStorage.addRegisteredUser({ userId: res.user.id, phoneNumber: res.user.phoneNumber });
    return res.user;
  };

  const logout = async (): Promise<void> => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setStatus('unauthenticated');
    }
  };

  return (
    <AuthContext.Provider value={{ user, status, login, pinLogin, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
