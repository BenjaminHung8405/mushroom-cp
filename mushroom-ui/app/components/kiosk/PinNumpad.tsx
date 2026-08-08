'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Delete, Shuffle, AlertCircle } from 'lucide-react';

interface PinNumpadProps {
  onComplete: (pin: string) => void;
  disabled?: boolean;
  error?: string | null;
  enableShuffle?: boolean;
  enablePhysicalKeyboard?: boolean;
}

export function PinNumpad({
  onComplete,
  disabled = false,
  error = null,
  enableShuffle = false,
  enablePhysicalKeyboard = true,
}: PinNumpadProps) {
  const [pin, setPin] = useState('');
  const [digits, setDigits] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
  const [isShuffled, setIsShuffled] = useState(false);
  const [shake, setShake] = useState(false);

  const triggerHaptic = useCallback(() => {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(50);
      } catch {
        // Ignore vibration errors if restricted by device policy
      }
    }
  }, []);

  const shuffleDigits = useCallback(() => {
    triggerHaptic();
    setDigits((prev) => {
      const arr = [...prev];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    });
    setIsShuffled(true);
  }, [triggerHaptic]);

  // Shuffle on mount removed: auto-rearranging digits confuses low-tech users
  // (farmers). The Shuffle button below is still available as an opt-in
  // anti-peeping feature when the user explicitly wants it.

  useEffect(() => {
    if (error) {
      setShake(true);
      setPin('');
      // Auto-shuffle on error removed: re-randomising the layout after a wrong
      // PIN forces the user to relearn button positions mid-session, which is
      // frustrating on a touch-only kiosk.
      const timer = setTimeout(() => setShake(false), 500);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleKeyPress = useCallback((digit: number) => {
    if (disabled) return;
    triggerHaptic();
    setPin((prev) => {
      if (prev.length >= 6) return prev;
      const next = prev + digit.toString();
      if (next.length === 6) {
        setTimeout(() => onComplete(next), 50);
      }
      return next;
    });
  }, [disabled, onComplete, triggerHaptic]);

  const handleDelete = useCallback(() => {
    if (disabled) return;
    triggerHaptic();
    setPin((prev) => prev.slice(0, -1));
  }, [disabled, triggerHaptic]);

  const handleClear = useCallback(() => {
    if (disabled) return;
    setPin('');
  }, [disabled]);

  // Keyboard navigation fallback
  useEffect(() => {
    if (!enablePhysicalKeyboard) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return;
      if (/^[0-9]$/.test(e.key)) {
        handleKeyPress(parseInt(e.key, 10));
      } else if (e.key === 'Backspace') {
        handleDelete();
      } else if (e.key === 'Escape') {
        handleClear();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [disabled, enablePhysicalKeyboard, handleKeyPress, handleDelete, handleClear]);

  return (
    <div className="flex flex-col items-center w-full max-w-sm mx-auto select-none">
      {/* 6 Dot Indicators */}
      <div
        className={`flex justify-center items-center gap-4 mb-6 transition-transform duration-200 ${
          shake ? 'motion-safe:animate-shake text-red-400' : ''
        }`}
        aria-label={`Mã PIN đã nhập ${pin.length} trên 6 số`}
      >
        {Array.from({ length: 6 }).map((_, idx) => {
          const filled = idx < pin.length;
          return (
            <div
              key={idx}
              className={`size-6 rounded-full transition-all duration-200 border-2 ${
                filled
                  ? 'bg-emerald-500 border-emerald-400 scale-110 shadow-[0_0_12px_rgba(34,197,94,0.5)]'
                  : 'bg-slate-900 border-slate-700'
              }`}
            />
          );
        })}
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2 mb-4 px-4 py-2.5 text-sm font-semibold text-red-300 bg-red-950/90 border border-red-800/80 rounded-xl motion-safe:animate-fade-in w-full text-center justify-center">
          <AlertCircle className="size-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Touch Numpad Grid 3x4 */}
      <div className="grid grid-cols-3 gap-4 w-full">
        {digits.slice(0, 9).map((num) => (
          <button
            key={num}
            type="button"
            disabled={disabled}
            onClick={() => handleKeyPress(num)}
            aria-label={`Bấm số ${num}`}
            className="flex items-center justify-center h-16 rounded-xl border border-slate-800 bg-slate-900/90 text-2xl font-mono font-bold text-slate-100 shadow-md cursor-pointer transition-all duration-75 hover:bg-slate-800 hover:border-slate-700 active:scale-95 active:bg-emerald-600 active:text-white disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            {num}
          </button>
        ))}

        {/* Bottom Row: Anti-peeping shuffle button, 10th digit, Delete button */}
        <button
          type="button"
          disabled={disabled}
          onClick={shuffleDigits}
          aria-label={isShuffled ? 'Bàn phím đã xáo trộn. Bấm để xáo trộn lại' : 'Bấm để xáo trộn bàn phím chống nhìn lén'}
          title={isShuffled ? 'Xáo trộn bàn phím (Chống nhìn lén)' : 'Bật chống nhìn lén'}
          className={`flex items-center justify-center h-16 rounded-xl border text-xs font-semibold shadow-md cursor-pointer transition-all duration-75 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
            isShuffled
              ? 'border-emerald-500/40 bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/70'
              : 'border-slate-800 bg-slate-900/90 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
        >
          <Shuffle className="size-5" />
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => handleKeyPress(digits[9])}
          aria-label={`Bấm số ${digits[9]}`}
          className="flex items-center justify-center h-16 rounded-xl border border-slate-800 bg-slate-900/90 text-2xl font-mono font-bold text-slate-100 shadow-md cursor-pointer transition-all duration-75 hover:bg-slate-800 hover:border-slate-700 active:scale-95 active:bg-emerald-600 active:text-white disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          {digits[9]}
        </button>

        <button
          type="button"
          disabled={disabled || pin.length === 0}
          onClick={handleDelete}
          aria-label="Xóa số đã nhập"
          className="flex items-center justify-center h-16 rounded-xl border border-slate-800 bg-slate-900/90 text-slate-300 shadow-md cursor-pointer transition-all duration-75 hover:bg-slate-800 hover:text-red-400 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <Delete className="size-6" />
        </button>
      </div>
    </div>
  );
}
