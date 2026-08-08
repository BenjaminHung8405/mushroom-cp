'use client';

import React, { useState } from 'react';
import { PinNumpad } from './PinNumpad';
import { StepProgress } from './StepProgress';
import { AvatarPicker, AgricultureAvatarPreset, AgricultureAvatars } from './AvatarPicker';
import { authApi } from '@/lib/auth-api';
import { kioskStorage } from '@/lib/kiosk-storage';
import { ShieldCheck, X, CheckCircle2 } from 'lucide-react';

interface PinSetupModalProps {
  userId: string;
  phoneNumber: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type SetupStep = 'current_pin' | 'avatar' | 'new_pin' | 'confirm_pin' | 'success';

const STEP_TITLES = ['Xác nhận', 'Avatar', 'Tạo PIN', 'Xác nhận PIN'];

export function PinSetupModal({
  userId,
  phoneNumber,
  open,
  onClose,
  onSuccess,
}: PinSetupModalProps) {
  const [step, setStep] = useState<SetupStep>('current_pin');
  const [currentPin, setCurrentPin] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState<AgricultureAvatarPreset>(AgricultureAvatars[0]);
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const getStepIndex = (): number => {
    switch (step) {
      case 'current_pin': return 0;
      case 'avatar': return 1;
      case 'new_pin': return 2;
      case 'confirm_pin': return 3;
      case 'success': return 4;
    }
  };

  const handleCurrentPinComplete = (pin: string) => {
    setCurrentPin(pin);
    setError(null);
    setStep('avatar');
  };

  const handleAvatarSelectComplete = () => {
    setError(null);
    setStep('new_pin');
  };

  const handleNewPinComplete = (pin: string) => {
    setNewPin(pin);
    setError(null);
    setStep('confirm_pin');
  };

  const handleConfirmPinComplete = async (confirmPin: string) => {
    if (confirmPin !== newPin) {
      setError('Mã PIN xác nhận không khớp. Vui lòng thử lại.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const deviceToken = kioskStorage.getDeviceToken();
      await authApi.pinSetup(currentPin, newPin, deviceToken, 'Tablet Kiosk');
      kioskStorage.addRegisteredUser({ userId, phoneNumber });
      setStep('success');
      setTimeout(() => {
        onSuccess();
      }, 1800);
    } catch (err: any) {
      setError(err.message || 'Thiết lập mã PIN thất bại.');
      setStep('current_pin');
      setCurrentPin('');
      setNewPin('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/85 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl z-10 text-slate-100 motion-safe:animate-scale-in">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 size-10 rounded-xl border border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200 flex items-center justify-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          aria-label="Đóng cửa sổ"
        >
          <X className="size-5" />
        </button>

        <div className="flex items-center gap-3 mb-4 border-b border-slate-800/80 pb-4">
          <div className="size-11 rounded-xl bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400 shrink-0">
            <ShieldCheck className="size-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100 font-mono">
              Bật Đăng Nhập Nhanh bằng PIN
            </h3>
            <p className="text-sm text-slate-300">
              Ghim tài khoản vào Tablet này để đăng nhập 6 số
            </p>
          </div>
        </div>

        {/* Visual Progress Steps */}
        {step !== 'success' && (
          <StepProgress steps={STEP_TITLES} current={getStepIndex()} />
        )}

        {step === 'current_pin' && (
          <div>
            <p className="text-center text-sm text-slate-300 font-medium mb-4">
              Nhập lại 6 số mật khẩu bạn vừa dùng để đăng nhập:
            </p>
            <PinNumpad
              onComplete={handleCurrentPinComplete}
              disabled={loading}
              error={error}
            />
          </div>
        )}

        {step === 'avatar' && (
          <div className="flex flex-col items-center">
            <AvatarPicker
              selectedId={selectedAvatar.id}
              onSelect={setSelectedAvatar}
            />
            <button
              type="button"
              onClick={handleAvatarSelectComplete}
              className="mt-4 w-full py-3.5 px-4 rounded-xl bg-emerald-500 text-slate-950 font-bold text-sm hover:bg-emerald-400 cursor-pointer transition-colors shadow-lg active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            >
              Tiếp tục: Tạo mã PIN 6 số
            </button>
          </div>
        )}

        {step === 'new_pin' && (
          <div>
            <p className="text-center text-sm text-slate-300 font-medium mb-4">
              Chọn 6 số dễ nhớ — bạn sẽ dùng để đăng nhập mỗi ngày:
            </p>
            <PinNumpad
              onComplete={handleNewPinComplete}
              disabled={loading}
              error={error}
            />
          </div>
        )}

        {step === 'confirm_pin' && (
          <div>
            <p className="text-center text-sm text-slate-300 font-medium mb-4">
              Nhập lại 6 số vừa chọn để xác nhận:
            </p>
            <PinNumpad
              onComplete={handleConfirmPinComplete}
              disabled={loading}
              error={error}
            />
          </div>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center justify-center py-8 text-center motion-safe:animate-fade-in">
            <div className="size-20 rounded-full bg-emerald-950 border-2 border-emerald-400 text-emerald-400 flex items-center justify-center mb-4 motion-safe:animate-bounce shadow-[0_0_20px_rgba(34,197,94,0.4)]">
              <CheckCircle2 className="size-12" />
            </div>
            <h4 className="text-xl font-bold text-emerald-300 font-mono">
              Xong! Đã ghim tài khoản 🎉
            </h4>
            <p className="mt-2 text-sm text-slate-300 leading-relaxed">
              Lần sau chỉ cần bấm ảnh đại diện của bạn và nhập 6 số PIN là vào ngay!
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
