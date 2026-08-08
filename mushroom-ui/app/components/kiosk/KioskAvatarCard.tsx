'use client';

import React from 'react';
import { generateAvatarGradient, maskPhoneNumber } from '@/lib/kiosk-storage';
import { User, X } from 'lucide-react';

interface KioskAvatarCardProps {
  phoneNumber: string;
  displayName?: string;
  onClick: () => void;
  onRemove?: () => void;
}

export function KioskAvatarCard({
  phoneNumber,
  displayName,
  onClick,
  onRemove,
}: KioskAvatarCardProps) {
  const gradient = generateAvatarGradient(phoneNumber);
  const formattedName = displayName || maskPhoneNumber(phoneNumber);

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        className="flex flex-col items-center gap-3 p-5 rounded-2xl border border-slate-800 bg-slate-900/80 shadow-lg cursor-pointer transition-all duration-200 hover:scale-105 hover:bg-slate-800/90 hover:border-slate-700 hover:shadow-emerald-950/20 active:scale-98 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 w-full"
      >
        <div
          className={`size-20 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white shadow-md border-2 border-slate-700/50 group-hover:border-emerald-400/60 transition-colors duration-200`}
        >
          <User className="size-10 text-white/90" />
        </div>

        <div className="text-center min-w-0">
          <p className="font-mono text-sm font-semibold text-slate-100 group-hover:text-emerald-300 transition-colors duration-200">
            {formattedName}
          </p>
          <span className="inline-block mt-1 text-[11px] font-medium uppercase tracking-wider text-slate-400 bg-slate-950/60 px-2 py-0.5 rounded-full border border-slate-800">
            Nông dân
          </span>
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
          className="absolute top-2 right-2 size-8 rounded-full bg-slate-950/80 border border-slate-800 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-red-950 hover:border-red-800 hover:text-red-300 transition-all duration-200 flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
