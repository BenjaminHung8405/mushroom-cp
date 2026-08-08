'use client';

import React from 'react';
import { Check } from 'lucide-react';

interface StepProgressProps {
  steps: string[];
  current: number; // 0-indexed
}

export function StepProgress({ steps, current }: StepProgressProps) {
  return (
    <div className="w-full py-2 mb-6">
      <div className="flex items-center justify-between relative">
        {steps.map((label, idx) => {
          const isCompleted = idx < current;
          const isCurrent = idx === current;

          return (
            <React.Fragment key={idx}>
              {/* Connector line between steps */}
              {idx > 0 && (
                <div
                  className={`flex-1 h-0.5 mx-2 transition-colors duration-300 ${
                    idx <= current ? 'bg-emerald-500' : 'bg-slate-800'
                  }`}
                />
              )}

              {/* Step indicator item */}
              <div className="flex flex-col items-center relative group">
                <div
                  className={`size-8 rounded-full flex items-center justify-center text-xs font-mono font-bold transition-all duration-300 ${
                    isCompleted
                      ? 'bg-emerald-500 text-slate-950 shadow-[0_0_10px_rgba(34,197,94,0.4)]'
                      : isCurrent
                      ? 'bg-slate-900 border-2 border-emerald-400 text-emerald-400 shadow-[0_0_12px_rgba(34,197,94,0.3)] ring-4 ring-emerald-500/10'
                      : 'bg-slate-900 border border-slate-700 text-slate-500'
                  }`}
                >
                  {isCompleted ? <Check className="size-4 stroke-[3]" /> : idx + 1}
                </div>
                <span
                  className={`mt-1.5 text-[11px] font-medium text-center whitespace-nowrap transition-colors duration-200 ${
                    isCurrent
                      ? 'text-emerald-400 font-semibold'
                      : isCompleted
                      ? 'text-slate-300'
                      : 'text-slate-500'
                  }`}
                >
                  {label}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
