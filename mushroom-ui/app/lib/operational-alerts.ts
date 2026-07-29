'use client'

import { useEffect, useMemo, useState } from 'react'

import type { DeviceStatus } from '@/lib/simulation-context'

export type AlertSeverity = 'critical' | 'warning' | 'system'
export type AlertCategory = 'environment' | 'connectivity' | 'protection' | 'synchronization'

export interface AlertEntry {
  id: string
  deviceId: string | null
  severity: AlertSeverity
  category: AlertCategory
  title: string
  message: string
  createdAt: string
  source: 'telemetry' | 'device-status' | 'edge' | 'sync'
  active: boolean
  groupCount: number
}

export interface OperationalAlertInput {
  deviceId: string | null
  temperature: number | null
  humidity: number | null
  co2: number | null
  deviceStatus: DeviceStatus
  lastTelemetryAt: string | null
  blackoutActive: boolean | null
  configSyncStatus: 'PENDING' | 'ACKED' | 'APPLIED' | 'FAILED' | 'TIMEOUT' | 'OUT_OF_SYNC' | null | undefined
  nowMs?: number
}

type AlertCondition = Omit<AlertEntry, 'createdAt' | 'active' | 'groupCount'>

const OFFLINE_GRACE_MS = 5 * 60 * 1_000
const WARNING_GROUP_WINDOW_MS = 30 * 60 * 1_000

function condition(
  id: string,
  severity: AlertSeverity,
  category: AlertCategory,
  title: string,
  message: string,
  source: AlertEntry['source'],
  deviceId: string | null,
): AlertCondition {
  return { id, severity, category, title, message, source, deviceId }
}

export function deriveOperationalAlerts(input: OperationalAlertInput): AlertCondition[] {
  const alerts: AlertCondition[] = []
  const { deviceId, temperature, humidity, co2, deviceStatus, lastTelemetryAt, blackoutActive, configSyncStatus } = input

  if (temperature !== null) {
    if (temperature < 20) {
      alerts.push(condition('temperature-frost', 'critical', 'environment', 'Nhiệt độ quá thấp', `Nhiệt độ ${temperature.toFixed(1)}°C dưới ngưỡng sống còn 20°C. Kiểm tra đèn nhiệt và nguồn điện.`, 'telemetry', deviceId))
    } else if (temperature > 38) {
      alerts.push(condition('temperature-overheat', 'critical', 'environment', 'Nhiệt độ quá cao', `Nhiệt độ ${temperature.toFixed(1)}°C vượt ngưỡng 38°C. Cần hạ nhiệt và tăng lưu thông khí.`, 'telemetry', deviceId))
    } else if (temperature < 28 || temperature > 35) {
      alerts.push(condition('temperature-warning', 'warning', 'environment', 'Nhiệt độ ngoài vùng tối ưu', `Nhiệt độ ${temperature.toFixed(1)}°C; vùng vận hành phù hợp là 28–35°C.`, 'telemetry', deviceId))
    }
  }

  if (humidity !== null) {
    if (humidity < 60 || humidity > 95) {
      alerts.push(condition('humidity-critical', 'critical', 'environment', 'Độ ẩm ở mức nguy hiểm', `Độ ẩm ${humidity.toFixed(1)}% có nguy cơ nhiễm tạp hoặc hỏng mầm nấm.`, 'telemetry', deviceId))
    } else if (humidity < 70 || humidity > 90) {
      alerts.push(condition('humidity-warning', 'warning', 'environment', 'Độ ẩm ngoài vùng tối ưu', `Độ ẩm ${humidity.toFixed(1)}%; vùng vận hành phù hợp là 70–90%.`, 'telemetry', deviceId))
    }
  }

  if (co2 !== null) {
    if (co2 > 1500) {
      alerts.push(condition('co2-critical', 'critical', 'environment', 'CO₂ ở mức nguy hiểm', `CO₂ ${Math.round(co2)} ppm vượt ngưỡng 1.500 ppm. Tăng thông gió để tránh nấm bị biến dạng.`, 'telemetry', deviceId))
    } else if (co2 > 1200) {
      alerts.push(condition('co2-warning', 'warning', 'environment', 'CO₂ cần được theo dõi', `CO₂ ${Math.round(co2)} ppm; nên tăng lưu thông khí để về vùng 800–1.200 ppm.`, 'telemetry', deviceId))
    }
  }

  const telemetryMs = lastTelemetryAt ? new Date(lastTelemetryAt).getTime() : Number.NaN
  const nowMs = input.nowMs ?? Date.now()
  if (deviceStatus === 'OFFLINE' && Number.isFinite(telemetryMs) && nowMs - telemetryMs >= OFFLINE_GRACE_MS) {
    alerts.push(condition('device-offline', 'critical', 'connectivity', 'Thiết bị mất kết nối', 'ESP32 đã offline quá 5 phút. Kiểm tra nguồn điện, Wi‑Fi và gateway tại nhà nấm.', 'device-status', deviceId))
  } else if (deviceStatus === 'DEGRADED_LATENCY' || deviceStatus === 'SENSOR_FAULT') {
    alerts.push(condition('device-degraded', 'warning', 'connectivity', deviceStatus === 'SENSOR_FAULT' ? 'Cảm biến không phản hồi' : 'Kết nối thiết bị yếu', 'Telemetry đang trễ hoặc không đầy đủ; dữ liệu điều khiển cần được kiểm tra tại thiết bị.', 'device-status', deviceId))
  }

  // This is a normal edge protection state, not a red survival incident. It
  // remains discoverable in the Alert Center without creating alert fatigue.
  if (blackoutActive === true) {
    alerts.push(condition('misting-protection-active', 'system', 'protection', 'Bảo vệ phun sương đang hoạt động', 'ESP32 đang khóa Mist/HWat theo cửa sổ bảo vệ sinh học.', 'edge', deviceId))
  }

  if (configSyncStatus === 'FAILED' || configSyncStatus === 'TIMEOUT' || configSyncStatus === 'OUT_OF_SYNC') {
    alerts.push(condition('config-sync-warning', 'warning', 'synchronization', 'Cấu hình chưa đồng bộ', 'Thiết bị chưa xác nhận cấu hình điều khiển mới nhất.', 'sync', deviceId))
  }

  return alerts
}

export function reconcileOperationalAlerts(
  entries: AlertEntry[],
  conditions: AlertCondition[],
  nowMs = Date.now(),
): AlertEntry[] {
  const activeIds = new Set(conditions.map((item) => item.id))
  const timestamp = new Date(nowMs).toISOString()
  let next = entries.map((entry) => entry.active && !activeIds.has(entry.id)
    ? { ...entry, active: false }
    : entry)

  for (const current of conditions) {
    const activeIndex = next.findIndex((entry) => entry.id === current.id && entry.deviceId === current.deviceId && entry.active)
    if (activeIndex >= 0) {
      next[activeIndex] = { ...next[activeIndex], ...current }
      continue
    }

    const latestIndex = next.findIndex((entry) =>
      entry.id === current.id &&
      entry.deviceId === current.deviceId &&
      entry.severity === current.severity &&
      nowMs - new Date(entry.createdAt).getTime() <= WARNING_GROUP_WINDOW_MS,
    )

    if (current.severity === 'warning' && latestIndex >= 0) {
      next[latestIndex] = {
        ...next[latestIndex],
        ...current,
        active: true,
        groupCount: next[latestIndex].groupCount + 1,
      }
      continue
    }

    next = [{ ...current, createdAt: timestamp, active: true, groupCount: 1 }, ...next]
  }

  return next
}

export function useOperationalAlerts(input: OperationalAlertInput) {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [entries, setEntries] = useState<AlertEntry[]>([])

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setEntries([])
  }, [input.deviceId])

  const conditions = useMemo(() => deriveOperationalAlerts({ ...input, nowMs }), [
    input.deviceId,
    input.temperature,
    input.humidity,
    input.co2,
    input.deviceStatus,
    input.lastTelemetryAt,
    input.blackoutActive,
    input.configSyncStatus,
    nowMs,
  ])

  useEffect(() => {
    setEntries((current) => reconcileOperationalAlerts(current, conditions, nowMs))
  }, [conditions, nowMs])

  return useMemo(
    () => [...entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [entries],
  )
}
