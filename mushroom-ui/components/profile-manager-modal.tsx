'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { authApi } from '@/lib/auth-api';
import { kioskStorage, formatPhoneNumber } from '@/lib/kiosk-storage';
import { AvatarPicker, AgricultureAvatars, AgricultureAvatarPreset } from '@/app/components/kiosk/AvatarPicker';
import { PinNumpad } from '@/app/components/kiosk/PinNumpad';
import {
  User,
  Key,
  Tablet,
  X,
  CheckCircle2,
  AlertCircle,
  Lock,
  Trash2,
  PlusCircle,
  ShieldCheck,
  Sprout,
  Save,
} from 'lucide-react';

interface ProfileManagerModalProps {
  open: boolean;
  onClose: () => void;
}

type TabType = 'profile' | 'pin' | 'kiosk';
type PinChangeStep = 'current_pin' | 'new_pin' | 'confirm_pin' | 'success';

export function ProfileManagerModal({ open, onClose }: ProfileManagerModalProps) {
  const { user, updateProfile, logout } = useAuth();

  // Tab State
  const [activeTab, setActiveTab] = useState<TabType>('profile');

  // Tab 1: Profile Form State
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [selectedAvatarId, setSelectedAvatarId] = useState<string>(user?.avatar || 'sprout');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Tab 2: PIN Change State
  const [pinStep, setPinStep] = useState<PinChangeStep>('current_pin');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinLoading, setPinLoading] = useState(false);

  // Tab 3: Kiosk Device State
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [isPinned, setIsPinned] = useState(false);
  const [kioskActionLoading, setKioskActionLoading] = useState(false);
  const [kioskMsg, setKioskMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sync state when user changes or modal opens
  useEffect(() => {
    if (open && user) {
      setFullName(user.fullName || '');
      setSelectedAvatarId(user.avatar || 'sprout');
      setDeviceToken(kioskStorage.getDeviceToken());
      setIsPinned(kioskStorage.hasRegisteredUser(user.id));
    }
  }, [open, user]);

  if (!open || !user) return null;

  // Active Avatar lookup
  const currentAvatarPreset = AgricultureAvatars.find((a) => a.id === selectedAvatarId) || AgricultureAvatars[0];
  const AvatarIcon = currentAvatarPreset.icon;

  // ---------------------------------------------------------------------------
  // Tab 1: Update Profile Handler
  // ---------------------------------------------------------------------------
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await updateProfile({
        fullName: fullName.trim(),
        avatar: selectedAvatarId,
      });
      setProfileMsg({ type: 'success', text: 'Cập nhật thông tin cá nhân thành công!' });
    } catch (err: any) {
      setProfileMsg({ type: 'error', text: err.message || 'Không thể lưu thông tin cá nhân.' });
    } finally {
      setProfileSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Tab 2: Change PIN Handlers
  // ---------------------------------------------------------------------------
  const handleCurrentPinComplete = (pin: string) => {
    setCurrentPin(pin);
    setPinError(null);
    setPinStep('new_pin');
  };

  const handleNewPinComplete = (pin: string) => {
    setNewPin(pin);
    setPinError(null);
    setPinStep('confirm_pin');
  };

  const handleConfirmPinComplete = async (confirmPin: string) => {
    if (confirmPin !== newPin) {
      setPinError('Mã PIN xác nhận không khớp. Vui lòng nhập lại.');
      return;
    }
    setPinError(null);
    setPinLoading(true);
    try {
      await authApi.setPin(currentPin, newPin);
      setPinStep('success');
      setTimeout(() => {
        // Log out user on PIN change as security measure per authApi backend logic
        logout();
      }, 2000);
    } catch (err: any) {
      setPinError(err.message || 'Lỗi khi đổi mã PIN.');
      setPinStep('current_pin');
      setCurrentPin('');
      setNewPin('');
    } finally {
      setPinLoading(false);
    }
  };

  const resetPinForm = () => {
    setPinStep('current_pin');
    setCurrentPin('');
    setNewPin('');
    setPinError(null);
  };

  // ---------------------------------------------------------------------------
  // Tab 3: Revoke Kiosk Device Handler
  // ---------------------------------------------------------------------------
  const handleRevokeDevice = async () => {
    if (!deviceToken || !user) return;
    if (!confirm('Bạn có chắc chắn muốn hủy ghim thiết bị này khỏi tài khoản không?')) return;

    setKioskActionLoading(true);
    setKioskMsg(null);
    try {
      await authApi.pinRevoke(deviceToken);
      kioskStorage.removeRegisteredUser(user.id);
      setIsPinned(false);
      setKioskMsg({ type: 'success', text: 'Đã hủy ghim thiết bị thành công!' });
    } catch (err: any) {
      setKioskMsg({ type: 'error', text: err.message || 'Lỗi khi hủy ghim thiết bị.' });
    } finally {
      setKioskActionLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/85 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Main Modal Container */}
      <div className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950 p-5 sm:p-6 shadow-2xl z-10 text-slate-100 max-h-[90vh] flex flex-col motion-safe:animate-scale-in">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 size-9 rounded-xl border border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200 flex items-center justify-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          aria-label="Đóng cửa sổ"
        >
          <X className="size-5" />
        </button>

        {/* Modal Header: Avatar + User Info Banner */}
        <div className="flex items-center gap-3 pb-4 border-b border-slate-800/80 shrink-0">
          <div className={`size-14 rounded-2xl bg-gradient-to-br ${currentAvatarPreset.gradient} p-0.5 shadow-lg flex items-center justify-center shrink-0`}>
            <div className="size-full bg-slate-950/40 rounded-[14px] flex items-center justify-center">
              <AvatarIcon className="size-7 text-white" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-white truncate">
              {user.fullName || formatPhoneNumber(user.phoneNumber)}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-mono text-xs text-slate-400">
                {formatPhoneNumber(user.phoneNumber)}
              </span>
              <span
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ${
                  user.role === 'ADMIN'
                    ? 'border border-purple-500/40 bg-purple-950/40 text-purple-300'
                    : user.role === 'OPERATOR'
                    ? 'border border-emerald-500/40 bg-emerald-950/40 text-emerald-300'
                    : 'border border-blue-500/40 bg-blue-950/40 text-blue-300'
                }`}
              >
                {user.role === 'ADMIN' ? 'Quản Trị Viên' : user.role === 'OPERATOR' ? 'Master Operator' : 'Kiểm Toán Viên'}
              </span>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="grid grid-cols-3 gap-1.5 p-1 my-4 rounded-xl bg-slate-900/80 border border-slate-800/80 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'profile'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <User className="size-4" />
            <span className="truncate">Hồ sơ</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('pin');
              resetPinForm();
            }}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'pin'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Key className="size-4" />
            <span className="truncate">Mã PIN</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('kiosk')}
            className={`flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'kiosk'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <Tablet className="size-4" />
            <span className="truncate">Ghim Kiosk</span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="overflow-y-auto flex-1 pr-1 space-y-4">
          {/* TAB 1: Profile & Avatar Update */}
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              {profileMsg && (
                <div
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-xs font-medium ${
                    profileMsg.type === 'success'
                      ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                      : 'border-red-500/40 bg-red-950/40 text-red-200'
                  }`}
                >
                  {profileMsg.type === 'success' ? (
                    <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="size-4 text-red-400 shrink-0" />
                  )}
                  <span>{profileMsg.text}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Họ và tên người vận hành:
                </label>
                <input
                  type="text"
                  placeholder="Nhập họ và tên (VD: Nguyễn Văn Nông)"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  maxLength={100}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900/90 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors"
                />
              </div>

              {/* Avatar Picker Component */}
              <AvatarPicker
                selectedId={selectedAvatarId}
                onSelect={(preset) => setSelectedAvatarId(preset.id)}
              />

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={profileSaving}
                  className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-950/50 cursor-pointer disabled:opacity-50 active:scale-[0.98]"
                >
                  <Save className="size-4" />
                  <span>{profileSaving ? 'Đang lưu…' : 'Lưu Thay Đổi'}</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: Change Account PIN */}
          {activeTab === 'pin' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
                  <Key className="size-4 text-emerald-400" />
                  <span>Đổi Mã PIN Tài Khoản (Mật Khẩu Đăng Nhập)</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Mã PIN 6 số là mật khẩu chính dùng để đăng nhập SĐT và Kiosk.
                </p>
              </div>

              {pinStep !== 'success' && (
                <div className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-slate-800 bg-slate-900/60">
                  <div className={`flex items-center gap-1.5 text-xs font-mono font-bold ${pinStep === 'current_pin' ? 'text-emerald-400' : 'text-slate-400'}`}>
                    <span className={`size-5 rounded-full flex items-center justify-center text-[10px] ${pinStep === 'current_pin' ? 'bg-emerald-500 text-slate-950 font-extrabold' : 'bg-slate-800 text-slate-300'}`}>1</span>
                    <span>PIN Hiện Tại</span>
                  </div>
                  <div className="h-0.5 w-4 bg-slate-800" />
                  <div className={`flex items-center gap-1.5 text-xs font-mono font-bold ${pinStep === 'new_pin' ? 'text-emerald-400' : 'text-slate-400'}`}>
                    <span className={`size-5 rounded-full flex items-center justify-center text-[10px] ${pinStep === 'new_pin' ? 'bg-emerald-500 text-slate-950 font-extrabold' : 'bg-slate-800 text-slate-300'}`}>2</span>
                    <span>PIN Mới</span>
                  </div>
                  <div className="h-0.5 w-4 bg-slate-800" />
                  <div className={`flex items-center gap-1.5 text-xs font-mono font-bold ${pinStep === 'confirm_pin' ? 'text-emerald-400' : 'text-slate-400'}`}>
                    <span className={`size-5 rounded-full flex items-center justify-center text-[10px] ${pinStep === 'confirm_pin' ? 'bg-emerald-500 text-slate-950 font-extrabold' : 'bg-slate-800 text-slate-300'}`}>3</span>
                    <span>Xác Nhận</span>
                  </div>
                </div>
              )}

              {pinStep === 'current_pin' && (
                <div>
                  <p className="text-center text-xs text-slate-300 font-medium mb-3">
                    Nhập mã PIN 6 số hiện tại của bạn:
                  </p>
                  <PinNumpad
                    onComplete={handleCurrentPinComplete}
                    disabled={pinLoading}
                    error={pinError}
                  />
                </div>
              )}

              {pinStep === 'new_pin' && (
                <div>
                  <p className="text-center text-xs text-slate-300 font-medium mb-3">
                    Nhập mã PIN 6 số mới dễ nhớ:
                  </p>
                  <PinNumpad
                    onComplete={handleNewPinComplete}
                    disabled={pinLoading}
                    error={pinError}
                  />
                </div>
              )}

              {pinStep === 'confirm_pin' && (
                <div>
                  <p className="text-center text-xs text-slate-300 font-medium mb-3">
                    Nhập lại mã PIN mới để xác nhận:
                  </p>
                  <PinNumpad
                    onComplete={handleConfirmPinComplete}
                    disabled={pinLoading}
                    error={pinError}
                  />
                </div>
              )}

              {pinStep === 'success' && (
                <div className="flex flex-col items-center justify-center py-6 text-center motion-safe:animate-fade-in">
                  <div className="size-16 rounded-full bg-emerald-950 border-2 border-emerald-400 text-emerald-400 flex items-center justify-center mb-3 shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                    <CheckCircle2 className="size-10" />
                  </div>
                  <h4 className="text-base font-bold text-emerald-300 font-mono">
                    Đổi mã PIN thành công!
                  </h4>
                  <p className="mt-1.5 text-xs text-slate-400">
                    Hệ thống sẽ đăng xuất để bạn bảo mật tài khoản bằng mã PIN mới.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: Kiosk Device Binding Management */}
          {activeTab === 'kiosk' && (
            <div className="space-y-4">
              {kioskMsg && (
                <div
                  className={`flex items-center gap-2.5 p-3 rounded-xl border text-xs font-medium ${
                    kioskMsg.type === 'success'
                      ? 'border-emerald-500/40 bg-emerald-950/40 text-emerald-200'
                      : 'border-red-500/40 bg-red-950/40 text-red-200'
                  }`}
                >
                  {kioskMsg.type === 'success' ? (
                    <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="size-4 text-red-400 shrink-0" />
                  )}
                  <span>{kioskMsg.text}</span>
                </div>
              )}

              {isPinned ? (
                /* Case HAS Token: Pinned Kiosk Device */
                <div className="space-y-4">
                  <div className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-950/30 flex items-start gap-3">
                    <div className="size-10 rounded-lg bg-emerald-900/50 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                      <Lock className="size-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-emerald-300 font-mono flex items-center gap-1.5">
                        Máy tính bảng này đã được ghim an toàn
                      </h4>
                      <p className="mt-1 text-xs text-slate-300 leading-relaxed">
                        Bạn có thể đăng nhập cực nhanh bằng cách bấm ảnh đại diện và nhập 6 số PIN trên máy này.
                      </p>
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleRevokeDevice}
                      disabled={kioskActionLoading}
                      className="w-full py-3 px-4 rounded-xl border border-red-500/40 bg-red-950/50 text-red-300 hover:bg-red-900/60 font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 active:scale-[0.98]"
                    >
                      <Trash2 className="size-4" />
                      <span>{kioskActionLoading ? 'Đang hủy…' : 'Xóa & Hủy ghim thiết bị này'}</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Device not yet registered */
                <div className="space-y-3">
                  <div className="p-5 rounded-2xl border border-emerald-800/40 bg-emerald-950/30 text-center">
                    <p className="text-sm font-semibold text-emerald-300 mb-1">Đăng nhập lần đầu bằng SĐT để kích hoạt</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Thiết bị này sẽ tự được ghim sau khi bạn đăng nhập bằng Số điện thoại.
                      Lần sau chỉ cần chọn ảnh và nhập PIN.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
