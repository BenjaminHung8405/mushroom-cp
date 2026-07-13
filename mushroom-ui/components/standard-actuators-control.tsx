'use client'

import { Card } from '@/components/ui/card'
import { CloudFog, Wind, Zap, ShieldAlert } from 'lucide-react'

type EdgeState = boolean | null

interface ActuatorStatusRowProps {
  name: string
  description: string
  icon: React.ReactNode
  state: EdgeState
  locked?: boolean
  lockReason?: string
}

function ActuatorStatusRow({ name, description, icon, state, locked = false, lockReason }: ActuatorStatusRowProps) {
  const unavailable = state === null
  return (
    <div className={`p-4 rounded-lg border transition-all duration-300 ${state === true ? 'border-emerald-500/50 bg-emerald-950/20' : locked ? 'border-red-950/40 bg-red-950/5 opacity-80' : 'border-slate-700/50 bg-slate-900/20'}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${state === true ? 'bg-emerald-500/20' : locked ? 'bg-red-950/30' : 'bg-slate-700/30'}`}>{icon}</div>
          <div>
            <h4 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
              {name}
              {locked && <span className="text-[10px] font-bold uppercase bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded border border-red-500/20">Đã khóa</span>}
            </h4>
            <p className="text-xs mt-0.5 text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className={`min-w-14 text-center px-2 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide ${state === true ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
          {unavailable ? '—' : state ? 'ON' : 'OFF'}
        </div>
      </div>
      {unavailable && <p className="text-[11px] text-slate-500">Chưa có dữ liệu từ edge</p>}
      {locked && lockReason && <div className="flex items-center gap-1 text-[11px] text-red-400 font-medium"><ShieldAlert size={12} /><span>{lockReason}</span></div>}
    </div>
  )
}

interface StandardActuatorsControlProps {
  fanActive?: EdgeState
  heaterAirActive?: EdgeState
  heaterWaterActive?: EdgeState
  mistActive?: EdgeState
  blackoutActive?: EdgeState
  readOnly?: boolean
}

/** Read-only observation panel; all displayed SSR states are edge-confirmed. */
export function StandardActuatorsControl({
  fanActive = null,
  heaterAirActive = null,
  heaterWaterActive = null,
  mistActive = null,
  blackoutActive = null,
}: StandardActuatorsControlProps) {
  const blackoutConfirmed = blackoutActive === true
  const statusText = (state: EdgeState) => state === null ? '— / Chưa có dữ liệu từ edge' : state ? 'Đang hoạt động (ON)' : 'Tắt (OFF)'
  return (
    <Card className="p-6 border border-slate-700/50 bg-slate-950/40">
      <div className="mb-4"><h3 className="font-semibold text-foreground text-lg">Bộ chấp hành tiêu chuẩn</h3><p className="text-xs text-muted-foreground mt-1">Trạng thái SSR đã xác nhận từ edge (chỉ đọc)</p></div>
      <div className="space-y-3">
        <ActuatorStatusRow name="Quạt đối lưu" description="Tuần hoàn không khí / hạ nhiệt / xả CO₂" icon={<Wind className="w-5 h-5 text-cyan-400" />} state={fanActive} />
        <ActuatorStatusRow name="Đèn gia nhiệt không khí (H_AIR)" description="SSR gia nhiệt không khí do TPC xác nhận" icon={<Zap className="w-5 h-5 text-amber-400" />} state={heaterAirActive} />
        <ActuatorStatusRow name="Gia nhiệt nước (H_WAT — slot chờ phần cứng)" description="Slot SSR riêng, chưa đại diện tải vật lý đang vận hành" icon={<Zap className="w-5 h-5 text-blue-400" />} state={heaterWaterActive} />
        <ActuatorStatusRow name="Máy tạo ẩm siêu âm" description="Phun sương ON/OFF theo fuzzy/TPC pipeline" icon={<CloudFog className="w-5 h-5 text-teal-400" />} state={mistActive} locked={blackoutConfirmed} lockReason={blackoutConfirmed ? 'Blackout đã được edge xác nhận — TPC khóa mist' : undefined} />
      </div>
      <div className="mt-4 p-3 rounded bg-slate-900/30 border border-slate-700/30 text-xs text-muted-foreground space-y-1">
        <div>Blackout: <span className={blackoutConfirmed ? 'text-red-400 font-semibold' : 'text-slate-400'}>{blackoutConfirmed ? 'Đã xác nhận từ edge' : blackoutActive === null ? '— / Chưa có dữ liệu từ edge' : 'Không hoạt động'}</span></div>
        <div>Quạt: {statusText(fanActive)}</div><div>H_AIR: {statusText(heaterAirActive)}</div><div>H_WAT: {statusText(heaterWaterActive)}</div><div>Máy tạo ẩm: {statusText(mistActive)}</div>
      </div>
    </Card>
  )
}
