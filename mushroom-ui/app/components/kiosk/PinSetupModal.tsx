'use client';

import React, { useState } from 'react';
import { PinNumpad } from './PinNumpad';
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

type SetupStep = 'current_pin' | 'new_pin' | 'confirm_pin' | 'success';

export function PinSetupModal({
  userId,
  phoneNumber,
  open,
  onClose,
  onSuccess,
}: PinSetupModalProps) {
  const [step, setStep] = useState<SetupStep>('current_pin');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleCurrentPinComplete = (pin: string) => {
    setCurrentPin(pin);
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
      }, 1500);
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
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-md transition-opacity"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-6 shadow-2xl z-10 text-slate-100 animate-scale-in">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 size-9 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:bg-slate-800 hover:text-slate-200 flex items-center justify-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          aria-label="Đóng modal"
        >
          <X className="size-5" />
        </button>

        <div className="flex items-center gap-3 mb-6 border-b border-slate-800 pb-4">
          <div className="size-10 rounded-xl bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400">
            <ShieldCheck className="size-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-100 font-mono">
              Bật Đăng Nhập Nhanh bằng PIN
            </h3>
            <p className="text-xs text-slate-400">
              Ghim tài khoản vào Tablet này để đăng nhập nhanh 6 số
            </p>
          </div>
        </div>

        {step === 'current_pin' && (
          <div>
            <p className="text-center text-sm text-slate-300 font-medium mb-4">
              Bước 1/3: Nhập Mật khẩu chính hiện tại của bạn
            </p>
            <PinNumpad
              onComplete={handleCurrentPinComplete}
              disabled={loading}
              error={error}
            />
          </div>
        )}

        {step === 'new_pin' && (
          <div>
            <p className="text-center text-sm text-slate-300 font-medium mb-4">
              Bước 2/3: Tạo mã PIN 6 số dành riêng cho Tablet này
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
              Bước 3/3: Nhập lại mã PIN 6 số để xác nhận
            </p>
            <PinNumpad
              onComplete={handleConfirmPinComplete}
              disabled={loading}
              error={error}
            />
          </div>
        )}

        {step === 'success' && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="size-16 rounded-full bg-emerald-950 border-2 border-emerald-500 text-emerald-400 flex items-center justify-center mb-4 animate-bounce">
              <CheckCircle2 className="size-10" />
            </div>
            <h4 className="text-lg font-bold text-emerald-300 font-mono">
              Đã ghim thiết bị thành công!
            </h4>
            <p className="mt-1 text-xs text-slate-400">
              Bạn có thể sử dụng mã PIN 6 số này để đăng nhập nhanh trên Tablet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
