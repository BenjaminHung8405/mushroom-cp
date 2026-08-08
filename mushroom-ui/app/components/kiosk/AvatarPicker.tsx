'use client';

import React from 'react';
import {
  Sprout,
  Tractor,
  Sun,
  Droplets,
  UserCheck,
  Smile,
  Home,
  Leaf,
} from 'lucide-react';

export interface AgricultureAvatarPreset {
  id: string;
  label: string;
  gradient: string;
  icon: React.ElementType;
}

export const AgricultureAvatars: AgricultureAvatarPreset[] = [
  { id: 'sprout', label: 'Mầm Nấm', gradient: 'from-emerald-600 to-teal-800', icon: Sprout },
  { id: 'tractor', label: 'Máy Kéo', gradient: 'from-amber-600 to-orange-800', icon: Tractor },
  { id: 'sun', label: 'Ánh Nắng', gradient: 'from-yellow-500 to-amber-600', icon: Sun },
  { id: 'droplets', label: 'Giọt Nước', gradient: 'from-blue-600 to-cyan-800', icon: Droplets },
  { id: 'farmer-m', label: 'Nông Dân', gradient: 'from-emerald-700 to-green-900', icon: UserCheck },
  { id: 'farmer-f', label: 'Bác Nông Dân', gradient: 'from-purple-600 to-pink-800', icon: Smile },
  { id: 'house', label: 'Nhà Nấm', gradient: 'from-slate-600 to-slate-800', icon: Home },
  { id: 'leaf', label: 'Bội Thu', gradient: 'from-lime-600 to-emerald-800', icon: Leaf },
];

interface AvatarPickerProps {
  selectedId: string;
  onSelect: (preset: AgricultureAvatarPreset) => void;
}

export function AvatarPicker({ selectedId, onSelect }: AvatarPickerProps) {
  return (
    <div className="w-full my-4">
      <p className="text-sm font-medium text-slate-300 mb-3 text-center">
        Chọn biểu tượng dễ nhớ cho tài khoản của bạn:
      </p>

      <div className="grid grid-cols-4 gap-3 max-w-xs mx-auto">
        {AgricultureAvatars.map((item) => {
          const Icon = item.icon;
          const isSelected = selectedId === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              aria-label={`Chọn biểu tượng ${item.label}`}
              className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border transition-all duration-150 cursor-pointer active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                isSelected
                  ? 'border-emerald-400 bg-emerald-950/60 ring-2 ring-emerald-400/50 shadow-[0_0_12px_rgba(34,197,94,0.3)]'
                  : 'border-slate-800 bg-slate-900/60 hover:bg-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div
                className={`size-12 rounded-full bg-gradient-to-br ${item.gradient} flex items-center justify-center text-white shadow-md`}
              >
                <Icon className="size-6 text-white/90" />
              </div>
              <span className="text-[11px] font-semibold text-slate-200 truncate max-w-full">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
