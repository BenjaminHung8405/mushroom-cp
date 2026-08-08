'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi, type AuthUser } from './auth-api';
import { kioskStorage } from './kiosk-storage';

interface AuthContextType {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  login: (phone: string, pin: string) => Promise<AuthUser>;
  pinLogin: (phone: string, pin: string) => Promise<AuthUser>;
  updateProfile: (dto: { fullName?: string; avatar?: string }) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

import { MustSetPinModal } from '@/components/must-set-pin-modal';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');

  const refresh = useCallback(async () => {
    try {
      const me = await authApi.me();
      if (me) {
        setUser(me);
        setStatus('authenticated');
        if (kioskStorage.hasRegisteredUser(me.id)) {
          kioskStorage.updateRegisteredUserProfile(me.id, {
            fullName: me.fullName,
            avatar: me.avatar,
            role: me.role,
          });
        }
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
    // Save to kiosk registered users
    kioskStorage.addRegisteredUser({
      userId: res.user.id,
      phoneNumber: res.user.phoneNumber,
      fullName: res.user.fullName,
      avatar: res.user.avatar,
      role: res.user.role,
    });
    return res.user;
  };

  const pinLogin = async (phone: string, pin: string): Promise<AuthUser> => {
    const deviceToken = kioskStorage.getDeviceToken();
    const res = await authApi.pinLogin(phone, pin, deviceToken);
    setUser(res.user);
    setStatus('authenticated');
    // Save to kiosk registered users
    kioskStorage.addRegisteredUser({
      userId: res.user.id,
      phoneNumber: res.user.phoneNumber,
      fullName: res.user.fullName,
      avatar: res.user.avatar,
      role: res.user.role,
    });
    return res.user;
  };

  const updateProfile = async (dto: { fullName?: string; avatar?: string }): Promise<AuthUser> => {
    const updated = await authApi.updateProfile(dto);
    setUser(updated);
    if (kioskStorage.hasRegisteredUser(updated.id)) {
      kioskStorage.updateRegisteredUserProfile(updated.id, {
        fullName: updated.fullName,
        avatar: updated.avatar,
        role: updated.role,
      });
    }
    return updated;
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
    <AuthContext.Provider value={{ user, status, login, pinLogin, updateProfile, logout, refresh }}>
      {children}
      {status === 'authenticated' && user?.mustSetPin && (
        <MustSetPinModal
          phoneNumber={user.phoneNumber}
          onSuccess={() => logout()}
          onLogout={() => logout()}
        />
      )}
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
