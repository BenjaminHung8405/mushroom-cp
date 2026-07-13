'use client'

import { Card } from '@/components/ui/card'
import { CloudFog, Wind, Zap, ShieldAlert } from 'lucide-react'

interface ActuatorStatusRowProps {
  name: string
  description: string
  icon: React.ReactNode
  isActive: boolean
  locked?: boolean
  lockReason?: string
}

function ActuatorStatusRow({
  name,
  description,
  icon,
  isActive,
  locked = false,
  lockReason,
}: ActuatorStatusRowProps) {
  return (
    <div
      className={`p-4 rounded-lg border transition-all duration-300 ${
        isActive
          ? 'border-emerald-500/50 bg-emerald-950/20'
          : locked
            ? 'border-red-950/40 bg-red-950/5 opacity-80'
            : 'border-slate-700/50 bg-slate-900/20'
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-lg ${
              isActive
                ? 'bg-emerald-500/20'
                : locked
                  ? 'bg-red-950/30'
                  : 'bg-slate-700/30'
            }`}
          >
            {icon}
          </div>
          <div>
            <h4 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
              {name}
              {locked && (
                <span className="text-[10px] font-bold uppercase bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded border border-red-500/20">
                  Locked
                </span>
              )}
            </h4>
            <p className="text-xs mt-0.5 text-muted-foreground">{description}</p>
          </div>
        </div>
        <div
          className={`min-w-14 text-center px-2 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${
            isActive
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'bg-slate-800 text-slate-400 border border-slate-700'
          }`}
        >
          {isActive ? 'ON' : 'OFF'}
        </div>
      </div>

      {locked && lockReason && (
        <div className="flex items-center gap-1 text-[11px] text-red-400 font-medium">
          <ShieldAlert size={12} />
          <span>{lockReason}</span>
        </div>
      )}
    </div>
  )
}

interface StandardActuatorsControlProps {
  fanActive?: boolean
  lampActive?: boolean
  mistActive?: boolean
  blackoutActive?: boolean
  readOnly?: boolean
}

/**
 * Read-only actuator observation panel.
 * Production MVP does not allow browser-side relay toggles —
 * the Core 1 fuzzy/TPC pipeline owns SSR safety control.
 */
export function StandardActuatorsControl({
  fanActive = false,
  lampActive = false,
  mistActive = false,
  blackoutActive = false,
}: StandardActuatorsControlProps) {
  return (
    <Card className="p-6 border border-slate-700/50 bg-slate-950/40">
      <div className="mb-4">
        <h3 className="font-semibold text-foreground text-lg">Bộ chấp hành tiêu chuẩn</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Trạng thái quan sát từ edge (read-only) — không điều khiển tay từ UI
        </p>
      </div>

      <div className="space-y-3">
        <ActuatorStatusRow
          name="Quạt đối lưu"
          description="Tuần hoàn không khí / hạ nhiệt / xả CO₂"
          icon={<Wind className="w-5 h-5 text-cyan-400" />}
          isActive={fanActive}
        />

        <ActuatorStatusRow
          name="Đèn gia nhiệt"
          description="Gia nhiệt không khí khi dưới ngưỡng tối thiểu"
          icon={<Zap className="w-5 h-5 text-amber-400" />}
          isActive={lampActive}
        />

        <ActuatorStatusRow
          name="Máy tạo ẩm siêu âm"
          description="Phun sương ON/OFF theo fuzzy/TPC pipeline"
          icon={<CloudFog className="w-5 h-5 text-teal-400" />}
          isActive={mistActive}
          locked={blackoutActive}
          lockReason={
            blackoutActive
              ? 'Midday blackout đang bật — TPC khóa mist'
              : undefined
          }
        />
      </div>

      <div className="mt-4 p-3 rounded bg-slate-900/30 border border-slate-700/30">
        <div className="text-xs text-muted-foreground space-y-1">
          <div>
            <span className="text-slate-400">Quạt: </span>
            <span className={fanActive ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
              {fanActive ? 'Đang hoạt động (ON)' : 'Tắt'}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Đèn: </span>
            <span className={lampActive ? 'text-amber-400 font-semibold' : 'text-slate-500'}>
              {lampActive ? 'Đang hoạt động (ON)' : 'Tắt'}
            </span>
          </div>
          <div>
            <span className="text-slate-400">Máy tạo ẩm: </span>
            <span className={mistActive ? 'text-teal-400 font-semibold' : 'text-slate-500'}>
              {blackoutActive
                ? 'Khóa blackout'
                : mistActive
                  ? 'Đang hoạt động (ON)'
                  : 'Tắt'}
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}
