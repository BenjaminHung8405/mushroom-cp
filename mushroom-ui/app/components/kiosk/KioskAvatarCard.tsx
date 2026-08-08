'use client';

import React from 'react';
import { generateAvatarGradient, maskPhoneNumber } from '@/lib/kiosk-storage';
import { AgricultureAvatars } from './AvatarPicker';
import { X, User } from 'lucide-react';

interface KioskAvatarCardProps {
  phoneNumber: string;
  fullName?: string;
  displayName?: string;
  avatar?: string;
  role?: string;
  onClick: () => void;
  onRemove?: () => void;
}

function getInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned || /^(\+84|0|\d|•)/.test(cleaned)) return 'ND';
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatRoleLabel(role?: string): string | null {
  if (!role) return null;
  switch (role.toUpperCase()) {
    case 'ADMIN':
      return 'Quản Trị Viên';
    case 'OPERATOR':
      return 'Master Operator';
    case 'AUDITOR':
      return 'Kiểm Toán';
    default:
      return role;
  }
}

export function KioskAvatarCard({
  phoneNumber,
  fullName,
  displayName,
  avatar,
  role,
  onClick,
  onRemove,
}: KioskAvatarCardProps) {
  const avatarPreset = avatar ? AgricultureAvatars.find((a) => a.id === avatar) : null;
  const gradient = avatarPreset ? avatarPreset.gradient : generateAvatarGradient(phoneNumber);
  const IconComponent = avatarPreset ? avatarPreset.icon : null;

  const displayPrimaryName = fullName?.trim() || displayName || maskPhoneNumber(phoneNumber);
  const isPhoneOnly = !fullName?.trim() && (!displayName || displayName === maskPhoneNumber(phoneNumber));
  const initials = getInitials(displayPrimaryName);
  const roleLabel = formatRoleLabel(role);

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        aria-label={`Tài khoản ${displayPrimaryName}`}
        className="flex flex-col items-center gap-3 p-4 sm:p-5 rounded-2xl border border-slate-800 bg-slate-900/80 shadow-lg cursor-pointer transition-all duration-200 hover:shadow-[0_0_25px_rgba(34,197,94,0.3)] hover:border-emerald-500/60 hover:bg-slate-800/90 active:scale-95 active:bg-slate-800 active:border-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 w-full"
      >
        {/* Avatar Circle */}
        <div
          className={`size-20 sm:size-22 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white shadow-xl border-2 border-slate-700/60 group-hover:border-emerald-400/70 transition-all duration-200 group-hover:scale-105`}
        >
          {IconComponent ? (
            <IconComponent className="size-10 text-white/95 drop-shadow-md" />
          ) : initials !== 'ND' ? (
            <span className="font-mono text-2xl font-black tracking-wider text-white select-none">
              {initials}
            </span>
          ) : (
            <User className="size-10 text-white/90" />
          )}
        </div>

        {/* User Info */}
        <div className="text-center min-w-0 w-full px-1 flex flex-col items-center gap-1">
          <div className="h-10 flex items-center justify-center w-full">
            <p className="text-sm sm:text-base font-bold text-slate-100 group-hover:text-emerald-300 transition-colors duration-200 line-clamp-2 leading-tight text-center break-words">
              {displayPrimaryName}
            </p>
          </div>

          {!isPhoneOnly && (
            <p className="font-mono text-xs font-medium text-slate-400 tracking-wide">
              {maskPhoneNumber(phoneNumber)}
            </p>
          )}

          {roleLabel && (
            <div className="pt-0.5">
              <span className="inline-block text-[10px] font-semibold tracking-wide uppercase px-2 py-0.5 rounded-full bg-slate-800/90 border border-slate-700/60 text-emerald-400 group-hover:border-emerald-500/40">
                {roleLabel}
              </span>
            </div>
          )}
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
          aria-label={`Bỏ ghim tài khoản ${displayPrimaryName}`}
          className="absolute top-2 right-2 size-9 rounded-xl bg-slate-950/85 border border-slate-800 text-slate-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-red-950 hover:border-red-800 hover:text-red-300 transition-all duration-200 flex items-center justify-center cursor-pointer active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 z-10 shadow-md"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
