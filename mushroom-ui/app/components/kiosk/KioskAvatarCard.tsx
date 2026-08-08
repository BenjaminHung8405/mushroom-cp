'use client';

import React from 'react';
import { generateAvatarGradient, maskPhoneNumber } from '@/lib/kiosk-storage';
import { X } from 'lucide-react';

interface KioskAvatarCardProps {
  phoneNumber: string;
  displayName?: string;
  onClick: () => void;
  onRemove?: () => void;
}

function getInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return 'ND';
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function KioskAvatarCard({
  phoneNumber,
  displayName,
  onClick,
  onRemove,
}: KioskAvatarCardProps) {
  const gradient = generateAvatarGradient(phoneNumber);
  const formattedName = displayName || maskPhoneNumber(phoneNumber);
  const initials = getInitials(formattedName);

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        aria-label={`Tài khoản ${formattedName}`}
        className="flex flex-col items-center gap-3 p-5 rounded-2xl border border-slate-800 bg-slate-900/80 shadow-lg cursor-pointer transition-all duration-200 hover:shadow-[0_0_20px_rgba(34,197,94,0.25)] hover:border-emerald-500/50 hover:bg-slate-800/90 active:scale-95 active:bg-slate-800 active:border-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 w-full"
      >
        <div
          className={`size-20 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white shadow-md border-2 border-slate-700/50 group-hover:border-emerald-400/60 transition-colors duration-200`}
        >
          <span className="font-mono text-2xl font-bold tracking-wider text-white select-none">
            {initials}
          </span>
        </div>

        <div className="text-center min-w-0 w-full px-1">
          <p className="text-sm font-semibold text-slate-100 group-hover:text-emerald-300 transition-colors duration-200 line-clamp-2 leading-tight">
            {formattedName}
          </p>
        </div>
      </button>

      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Bỏ ghim khỏi thiết bị này"
          aria-label={`Bỏ ghim tài khoản ${formattedName}`}
          className="absolute top-1.5 right-1.5 size-10 rounded-full bg-slate-950/80 border border-slate-800 text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-950 hover:border-red-800 hover:text-red-300 transition-all duration-200 flex items-center justify-center cursor-pointer active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          <X className="size-5" />
        </button>
      )}
    </div>
  );
}
