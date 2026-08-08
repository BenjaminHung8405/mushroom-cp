'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { kioskStorage, generateAvatarGradient, maskPhoneNumber, type KioskRegisteredUser } from '@/lib/kiosk-storage';
import { KioskAvatarCard } from '../components/kiosk/KioskAvatarCard';
import { PinNumpad } from '../components/kiosk/PinNumpad';
import { UserPlus, ArrowLeft, KeyRound, Lock, ShieldAlert, Cpu } from 'lucide-react';

function getInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return 'ND';
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function LoginPage() {
  const router = useRouter();
  const { user, status, login, pinLogin } = useAuth();

  const [registeredUsers, setRegisteredUsers] = useState<KioskRegisteredUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<KioskRegisteredUser | null>(null);

  // Error & Loading states
  const [pinError, setPinError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Primary password modal states
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);



  useEffect(() => {
    if (status === 'authenticated' && user) {
      router.replace('/');
    }
  }, [status, user, router]);

  useEffect(() => {
    // Always show the account picker (STATE 1) regardless of user count.
    // Auto-selecting when length === 1 was hiding the avatar grid and the
    // "Add account" button — users never knew those existed.
    const users = kioskStorage.getRegisteredUsers();
    setRegisteredUsers(users);
  }, []);

  const handlePinSubmit = async (pin: string) => {
    if (!selectedUser) return;
    setPinError(null);
    setLoading(true);
    try {
      await pinLogin(selectedUser.phoneNumber, pin);
      router.replace('/');
    } catch (err: any) {
      setPinError(err.message || 'Mã PIN không đúng. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };


  const handlePasswordLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setLoading(true);
    try {
      await login(phoneInput, passwordInput);
      // Device is auto-registered by the backend via the deviceToken sent in login().
      // No setup modal needed — redirect directly to the app.
      setShowPasswordModal(false);
    } catch (err: any) {
      setPasswordError(err.message || 'Số điện thoại hoặc Mật khẩu không đúng');
      setLoading(false);
    }
  };

  const handleRemoveUser = (userId: string) => {
    kioskStorage.removeRegisteredUser(userId);
    const updated = kioskStorage.getRegisteredUsers();
    setRegisteredUsers(updated);
    if (selectedUser?.userId === userId) {
      setSelectedUser(updated.length > 0 ? updated[0] : null);
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-300">
        <div className="size-12 rounded-full border-4 border-emerald-500/20 border-t-emerald-500 motion-safe:animate-spin mb-4" />
        <p className="font-mono text-base font-semibold">Đang tải AgriSmart OS…</p>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#0F172A] text-slate-100 flex flex-col justify-between p-6 select-none relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-emerald-500/10 blur-[120px] pointer-events-none rounded-full" />

      {/* Top Header / Brand — chỉ logo, không có button thứ cấp */}
      <header className="flex items-center z-10 max-w-4xl w-full mx-auto">
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-xl bg-emerald-950/80 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-md">
            <Cpu className="size-6" />
          </div>
          <div>
            <h1 className="font-mono text-lg font-bold tracking-tight text-slate-100">
              AgriSmart <span className="text-emerald-400">Kiosk</span>
            </h1>
            <p className="text-xs text-slate-300">Hệ thống Quản lý Nhà Nấm</p>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <section className="my-auto py-8 z-10 max-w-md w-full mx-auto">
        {selectedUser ? (
          /* STATE 2: PIN Entry Screen */
          <div className="flex flex-col items-center motion-safe:animate-fade-in">
            {/* User Profile Header */}
            <div className="relative mb-6 text-center w-full">
              {registeredUsers.length > 1 && (
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="absolute left-0 top-2 flex items-center gap-1.5 px-3 py-2 min-h-11 rounded-xl border border-slate-800 bg-slate-900/80 text-sm text-slate-300 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  <ArrowLeft className="size-4" />
                  <span>Đổi</span>
                </button>
              )}

              <div
                className={`size-20 mx-auto rounded-full bg-gradient-to-br ${generateAvatarGradient(
                  selectedUser.phoneNumber
                )} flex items-center justify-center text-white text-2xl font-bold shadow-lg border-2 border-emerald-400/50 mb-3`}
              >
                <span className="font-mono text-2xl font-bold tracking-wider">
                  {getInitials(selectedUser.displayName || maskPhoneNumber(selectedUser.phoneNumber))}
                </span>
              </div>
              <h2 className="font-mono text-lg font-bold text-slate-100">
                {selectedUser.displayName || maskPhoneNumber(selectedUser.phoneNumber)}
              </h2>
              <p className="text-sm text-slate-300 mt-1">Nhập 6 số PIN của bạn để vào hệ thống</p>
            </div>

            {/* PIN Numpad — shuffle tắt mặc định, nông dân cần bố cục ổn định.
                 Người dùng vẫn có thể tự bấm nút Shuffle nếu muốn (opt-in). */}
            <PinNumpad
              onComplete={handlePinSubmit}
              disabled={loading}
              error={pinError}
              enableShuffle={false}
            />

            {/* Fallback: text link nhỏ, không cạnh tranh với numpad */}
            <div className="mt-8 text-center">
              <button
                type="button"
                onClick={() => setShowPasswordModal(true)}
                className="text-sm font-medium text-slate-400 hover:text-emerald-400 hover:underline cursor-pointer transition-colors p-2"
              >
                Quên PIN hoặc bị khóa? Đăng nhập bằng Số điện thoại
              </button>
            </div>
          </div>
        ) : (
          /* STATE 1: User Selection Screen */
          <div className="motion-safe:animate-fade-in">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold font-mono text-slate-100">Chọn tài khoản</h2>
              <p className="text-sm text-slate-300 mt-1.5">
                Bấm vào ảnh của bạn để đăng nhập nhanh bằng PIN
              </p>
            </div>

            {registeredUsers.length > 0 ? (
              <>
                {/* Avatar grid — CTA chính */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
                  {registeredUsers.map((u) => (
                    <KioskAvatarCard
                      key={u.userId}
                      phoneNumber={u.phoneNumber}
                      displayName={u.displayName}
                      onClick={() => setSelectedUser(u)}
                      onRemove={() => handleRemoveUser(u.userId)}
                    />
                  ))}
                </div>

                {/* CTA phụ: text link nhỏ, phân cấp rõ ràng */}
                <div className="text-center">
                  <button
                    type="button"
                    onClick={() => setShowPasswordModal(true)}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-emerald-400 cursor-pointer transition-colors py-2 px-3 rounded-lg hover:bg-slate-900/50"
                  >
                    <UserPlus className="size-4" />
                    <span>Thêm tài khoản khác</span>
                  </button>
                </div>
              </>
            ) : (
              /* Empty state: 1 CTA duy nhất, nổi bật, không cạnh tranh */
              <div className="flex flex-col items-center gap-6">
                <div className="text-center py-10 px-4 rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 w-full">
                  <Lock className="size-12 text-slate-500 mx-auto mb-3" />
                  <p className="text-base font-semibold text-slate-200">
                    Chưa có ai ghim tài khoản trên máy tính bảng này
                  </p>
                  <p className="text-sm text-slate-400 mt-1.5 leading-relaxed">
                    Đăng nhập lần đầu để ghim tài khoản và bật đăng nhập nhanh bằng PIN.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowPasswordModal(true)}
                  className="w-full flex items-center justify-center gap-2.5 py-4 px-6 min-h-14 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-base font-bold text-white cursor-pointer transition-all duration-200 active:scale-95 shadow-lg shadow-emerald-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  <KeyRound className="size-5" />
                  <span>Đăng nhập bằng Số điện thoại</span>
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Footer */}
      <footer className="z-10 text-center py-2 text-xs font-mono text-slate-400">
        Bảo mật bởi AgriSmart OS v2.4
      </footer>

      {/* Phone + Password Login Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-950/85 backdrop-blur-md"
            onClick={() => setShowPasswordModal(false)}
          />
          <div className="relative w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl z-10 text-slate-100 motion-safe:animate-scale-in">
            <h3 className="text-lg font-bold font-mono text-slate-100 mb-1">
              Đăng nhập bằng Số điện thoại
            </h3>
            <p className="text-sm text-slate-300 mb-5">
              Dành cho tài khoản mới hoặc khi cần mở khóa thiết bị
            </p>

            {passwordError && (
              <div className="flex items-center gap-2 mb-4 p-3 text-sm font-semibold text-red-300 bg-red-950/90 border border-red-800/80 rounded-xl">
                <ShieldAlert className="size-5 shrink-0" />
                <span>{passwordError}</span>
              </div>
            )}

            <form onSubmit={handlePasswordLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-1.5">
                  Số điện thoại
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                  placeholder="VD: 0901234567"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  className="w-full px-4 py-3.5 rounded-xl border border-slate-800 bg-slate-900 text-slate-100 text-base font-mono focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-300 mb-1.5">
                  Mật khẩu / PIN (6 số)
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                  maxLength={6}
                  placeholder="••••••"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full px-4 py-3.5 rounded-xl border border-slate-800 bg-slate-900 text-slate-100 text-xl font-mono tracking-widest focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-4 py-3 min-h-11 rounded-xl border border-slate-800 bg-slate-900 text-sm font-semibold text-slate-300 hover:bg-slate-800 cursor-pointer active:scale-95"
                >
                  Quay lại
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-6 py-3 min-h-11 rounded-xl bg-emerald-500 text-slate-950 font-bold text-sm hover:bg-emerald-400 cursor-pointer transition-colors shadow-lg active:scale-95 disabled:opacity-50"
                >
                  {loading ? 'Đang xác thực…' : 'Đăng nhập'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </main>
  );
}
