'use client'

import React, { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useBatch } from '@/lib/batch-context'
import { CalendarRange, Sparkles, Send, Check, Play, Settings2 } from 'lucide-react'

export function BatchStatusPanel() {
  const {
    profileKey,
    loadProfilePreset,
    totalCropDays,
    updateTotalCropDaysAndScale,
  } = useBatch()

  // Local state to prevent destructive keystroke scaling
  const [localDays, setLocalDays] = useState(totalCropDays.toString())
  const [isDirty, setIsDirty] = useState(false)
  const [deployState, setDeployState] = useState<'idle' | 'deploying' | 'success'>('idle')

  useEffect(() => {
    setLocalDays(totalCropDays.toString())
    setIsDirty(false)
  }, [totalCropDays])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setLocalDays(val)
    const parsed = parseInt(val)
    setIsDirty(!isNaN(parsed) && parsed !== totalCropDays)
  }

  const commitDaysChange = () => {
    const val = parseInt(localDays)
    if (!isNaN(val) && val >= 10 && val <= 45) {
      updateTotalCropDaysAndScale(val)
      setIsDirty(false)
    } else {
      // Revert to current context value if invalid
      setLocalDays(totalCropDays.toString())
      setIsDirty(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitDaysChange()
      e.currentTarget.blur()
    }
  }

  const handleDeploy = () => {
    if (deployState !== 'idle') return
    setDeployState('deploying')
    setTimeout(() => {
      setDeployState('success')
      setTimeout(() => {
        setDeployState('idle')
      }, 2500)
    }, 1500)
  }

  return (
    <Card className="p-6 border border-slate-700/50 bg-slate-950/40 h-full flex flex-col justify-between relative overflow-hidden group/panel">
      {/* Background ambient light */}
      <div className="absolute -top-12 -right-12 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl group-hover/panel:bg-emerald-500/20 transition-all duration-500" />
      
      <div>
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground text-sm sm:text-base">Thiết lập sản xuất</h3>
            <p className="text-xs text-muted-foreground">Cấu hình chu kỳ vận hành thực tế</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Active Profile Dropdown */}
          <div className="space-y-1">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 block">
              Hồ sơ đang chạy
            </span>
            <div className="relative">
              <select
                value={profileKey}
                onChange={(e) => loadProfilePreset(e.target.value)}
                className="w-full bg-slate-900/40 hover:bg-slate-900/60 border border-slate-700/60 focus:border-emerald-500/50 rounded px-2.5 py-1.5 text-xs sm:text-sm font-semibold text-emerald-400 focus:outline-none transition-colors appearance-none cursor-pointer pr-8"
              >
                <option value="dry_season" className="bg-slate-950 text-slate-300 font-medium">Tối ưu mùa khô</option>
                <option value="rainy_season" className="bg-slate-950 text-slate-300 font-medium">Tối ưu mùa mưa</option>
                <option value="quick_fruiting" className="bg-slate-950 text-slate-300 font-medium">Kích quả nhanh</option>
              </select>
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-emerald-500/70">
                <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20">
                  <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Duration Input */}
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500 flex items-center gap-1">
              <CalendarRange className="w-3 h-3 text-slate-500" />
              Tổng thời lượng chu kỳ
            </span>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="number"
                  min="10"
                  max="45"
                  value={localDays}
                  onChange={handleInputChange}
                  onBlur={commitDaysChange}
                  onKeyDown={handleKeyDown}
                  className="w-full bg-slate-900/40 border border-slate-700/60 rounded px-3 py-1.5 text-sm font-bold text-foreground focus:outline-none focus:border-emerald-500/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none pr-10"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500 pointer-events-none">
                  ngày
                </span>
              </div>
              
              <Button
                variant={isDirty ? 'default' : 'outline'}
                size="sm"
                onClick={commitDaysChange}
                disabled={!isDirty}
                className={`text-[10px] font-bold tracking-wide uppercase px-2 h-8 ${
                  isDirty 
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.3)] animate-pulse' 
                    : 'text-slate-500 border-slate-800'
                }`}
              >
                Cập nhật
              </Button>
            </div>
            <p className="text-[10px] text-slate-500">
              Giới hạn: 10 - 45 ngày. Nhấn Enter hoặc click ngoài để áp dụng.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <Button
          onClick={handleDeploy}
          disabled={deployState === 'deploying'}
          className={`w-full py-4 h-10 gap-2 font-semibold text-xs tracking-wide uppercase rounded-lg border transition-all duration-300 ${
            deployState === 'deploying'
              ? 'bg-amber-600/20 border-amber-500/30 text-amber-400 cursor-not-allowed'
              : deployState === 'success'
              ? 'bg-emerald-500 border-emerald-600 text-white shadow-[0_0_15px_rgba(16,185,129,0.4)]'
              : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white border-transparent shadow-[0_4px_12px_rgba(16,185,129,0.15)] hover:shadow-[0_4px_20px_rgba(16,185,129,0.3)] hover:-translate-y-0.5'
          }`}
        >
          {deployState === 'idle' && (
            <>
              <Send className="w-3.5 h-3.5" />
              Triển khai ngay
            </>
          )}
          {deployState === 'deploying' && (
            <>
              <div className="w-3.5 h-3.5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              Đang gửi...
            </>
          )}
          {deployState === 'success' && (
            <>
              <Check className="w-4 h-4 stroke-[3px] animate-bounce" />
              Đã đồng bộ!
            </>
          )}
        </Button>
      </div>
    </Card>
  )
}
