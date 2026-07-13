'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarRange, Check, CircleAlert, Clock3, Play, Sprout, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useBatch } from '@/lib/batch-context'
import {
  createBatch,
  endBatch,
  fetchActiveBatch,
  fetchDeviceMapping,
  type ActiveBatch,
  type EndBatchStatus,
} from '@/lib/batch-api'

const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh'

type Dialog = 'start' | 'end' | null

function formatStartDate(date: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: VIETNAM_TIME_ZONE,
  }).format(new Date(date))
}

function millisecondsUntilVietnamMidnight(): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: VIETNAM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  const vietnamNow = new Date(Date.UTC(value('year'), value('month') - 1, value('day')))
  const nextVietnamMidnight = vietnamNow.getTime() + 24 * 60 * 60 * 1000
  const vietnamOffsetMs = 7 * 60 * 60 * 1000
  return Math.max(1_000, nextVietnamMidnight - (Date.now() + vietnamOffsetMs) + 50)
}

export function BatchStatusPanel() {
  const { profileKey, profileName, loadProfilePreset, totalCropDays, updateTotalCropDaysAndScale } = useBatch()
  const [batch, setBatch] = useState<ActiveBatch | null>(null)
  const [houseName, setHouseName] = useState<string | null>(null)
  const [houseId, setHouseId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [endStatus, setEndStatus] = useState<EndBatchStatus>('COMPLETED')

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const device = await fetchDeviceMapping()
      setHouseId(device.houseId)
      setHouseName(device.displayName)
      setBatch(await fetchActiveBatch(device.houseId))
    } catch (cause) {
      setBatch(null)
      setHouseId(null)
      setError(cause instanceof Error ? cause.message : 'Không thể tải trạng thái vụ.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  useEffect(() => {
    if (!batch) return
    const timeout = window.setTimeout(() => void refresh(), millisecondsUntilVietnamMidnight())
    return () => window.clearTimeout(timeout)
  }, [batch, refresh])

  const remainingDays = useMemo(
    () => (batch ? Math.max(0, batch.totalCropDays - batch.cropDay) : 0),
    [batch],
  )
  const isSpawnRunning = batch ? batch.cropDay <= batch.spawnRunningEndDay : false

  const handleStart = async () => {
    if (!houseId || actionLoading) return
    setActionLoading(true)
    setError(null)
    try {
      await createBatch({ houseId, profileName, totalCropDays })
      await refresh()
      setNotice('Đã bắt đầu vụ. Hôm nay được tính là Ngày 1.')
      setDialog(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể bắt đầu vụ.')
      setDialog(null)
      await refresh()
    } finally {
      setActionLoading(false)
    }
  }

  const handleEnd = async () => {
    if (!batch || actionLoading) return
    setActionLoading(true)
    setError(null)
    try {
      await endBatch(batch.id, endStatus)
      setNotice(endStatus === 'COMPLETED' ? 'Đã hoàn thành vụ.' : 'Đã hủy vụ.')
      setDialog(null)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể kết thúc vụ.')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <Card className="p-6 border border-slate-700/50 bg-slate-950/40 h-full flex flex-col relative overflow-hidden">
      <div className="absolute -top-12 -right-12 w-24 h-24 bg-emerald-500/10 rounded-full blur-2xl" />
      <div className="flex items-start gap-3 mb-5">
        <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"><Sprout className="w-5 h-5" /></div>
        <div>
          <h3 className="font-semibold text-foreground text-sm sm:text-base">Quản lý vụ trồng</h3>
          <p className="text-xs text-muted-foreground">{houseName ?? 'Xác định nhà nấm từ thiết bị'}</p>
        </div>
      </div>

      {notice && <div className="mb-4 flex gap-2 rounded border border-emerald-500/30 bg-emerald-950/20 p-2 text-xs text-emerald-300"><Check className="size-4 shrink-0" />{notice}</div>}
      {error && <div className="mb-4 flex gap-2 rounded border border-red-500/30 bg-red-950/20 p-2 text-xs text-red-300"><CircleAlert className="size-4 shrink-0" />{error}</div>}

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-500">Đang tải trạng thái vụ...</div>
      ) : !houseId ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-3 text-sm text-slate-400"><span>Không thể xác định nhà nấm của thiết bị đang theo dõi.</span><Button variant="outline" size="sm" onClick={() => void refresh()}>Thử lại</Button></div>
      ) : batch ? (
        <div className="flex flex-1 flex-col">
          <div className="mb-4 flex items-center justify-between"><span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-300">ACTIVE</span><span className="text-[11px] text-slate-500">{batch.id}</span></div>
          <p className="text-sm font-semibold text-emerald-300">{batch.profileName}</p>
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-400"><Clock3 className="size-3" />Bắt đầu: {formatStartDate(batch.startDate)}</p>
          <div className="my-5 rounded-lg border border-emerald-500/25 bg-emerald-950/20 p-4 text-center"><p className="text-[10px] uppercase font-bold tracking-wider text-emerald-400">Hôm nay</p><p className="mt-1 text-2xl font-bold text-foreground">Ngày {batch.cropDay} <span className="text-sm font-medium text-slate-400">/ {batch.totalCropDays}</span></p></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, (batch.cropDay / batch.totalCropDays) * 100)}%` }} /></div>
          <div className="mt-3 flex justify-between text-[11px] text-slate-400"><span>{isSpawnRunning ? `Giai đoạn nuôi tơ (đến ngày ${batch.spawnRunningEndDay})` : 'Giai đoạn phát triển/thu hoạch'}</span><span>Còn {remainingDays} ngày</span></div>
          <Button variant="outline" className="mt-6 border-red-500/40 text-red-300 hover:bg-red-950/40" onClick={() => { setEndStatus('COMPLETED'); setDialog('end') }}><X className="size-4" />Kết thúc vụ</Button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col">
          <div className="mb-5 rounded-lg border border-dashed border-slate-700 p-3 text-sm text-slate-400">Chưa có vụ đang chạy cho nhà nấm này.</div>
          <label className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Hồ sơ áp dụng</label>
          <select value={profileKey} onChange={(event) => loadProfilePreset(event.target.value)} className="mb-4 w-full rounded border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm text-emerald-300 focus:outline-none">
            <option value="dry_season">Tối ưu mùa khô</option><option value="rainy_season">Tối ưu mùa mưa</option><option value="quick_fruiting">Kích quả nhanh</option>
          </select>
          <label className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500"><CalendarRange className="size-3" />Tổng số ngày</label>
          <input type="number" min="10" max="45" value={totalCropDays} onChange={(event) => {
            const days = Number(event.target.value)
            if (Number.isInteger(days)) updateTotalCropDaysAndScale(days)
          }} className="mb-1 w-full rounded border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-semibold text-foreground focus:outline-none" />
          <p className="text-[10px] text-slate-500">Giới hạn 10–45 ngày.</p>
          <Button className="mt-6" onClick={() => setDialog('start')} disabled={actionLoading}><Play className="size-4" />Bắt đầu vụ</Button>
        </div>
      )}

      {dialog && <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"><div className="w-full rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-xl"><h4 className="font-semibold text-foreground">{dialog === 'start' ? 'Xác nhận bắt đầu vụ' : 'Xác nhận kết thúc vụ'}</h4>{dialog === 'start' ? <p className="mt-2 text-sm text-slate-400">Vụ “{profileName}” sẽ bắt đầu ngay. Hôm nay được tính là Ngày 1.</p> : <><p className="mt-2 text-sm text-slate-400">Chọn kết quả cho vụ đang chạy.</p><select value={endStatus} onChange={(event) => setEndStatus(event.target.value as EndBatchStatus)} className="mt-3 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-foreground"><option value="COMPLETED">Hoàn thành vụ</option><option value="ABORTED">Hủy vụ</option></select></>}<div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setDialog(null)} disabled={actionLoading}>Quay lại</Button><Button variant={dialog === 'end' ? 'destructive' : 'default'} onClick={() => void (dialog === 'start' ? handleStart() : handleEnd())} disabled={actionLoading}>{actionLoading ? 'Đang xử lý...' : 'Xác nhận'}</Button></div></div></div>}
    </Card>
  )
}
