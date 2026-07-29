import type { AlertCategory, AlertEntry } from '@/app/lib/operational-alerts'
import type { OperationalHistorySummary } from '@/app/lib/operational-history'

export type AttentionTarget = 'analysis' | 'curves' | 'alerts'

export interface OperationalAttentionItem {
  id: string
  title: string
  description: string
  target: AttentionTarget
  focusChatterAt?: number
}

export function buildOperationalAttention(
  alerts: AlertEntry[],
  history: OperationalHistorySummary,
): OperationalAttentionItem[] {
  const items: OperationalAttentionItem[] = []
  const latestChatter = history.chattering[0]
  if (latestChatter) {
    const device = latestChatter.field === 'mistState' ? 'Máy phun sương' : 'Đèn nhiệt'
    items.push({
      id: `relay-chatter-${latestChatter.field}-${latestChatter.startMs}`,
      title: `${device} đóng ngắt liên tục`,
      description: `${latestChatter.count} lần chuyển trạng thái trong 10 phút. Kiểm tra deadband và đoạn lịch sử liên quan.`,
      target: 'analysis',
      focusChatterAt: latestChatter.startMs,
    })
  }

  // A weak device link or an unsynchronised configuration can make every
  // subsequent control decision unreliable, so surface those before a normal
  // environmental amber state. Critical incidents remain in the sticky banner
  // rather than being duplicated in this limited strip.
  const warningPriority: Record<AlertCategory, number> = {
    connectivity: 0,
    synchronization: 1,
    protection: 2,
    environment: 3,
  }
  const actionableWarnings = alerts
    .filter((alert) => alert.active && alert.severity === 'warning')
    .sort((left, right) => warningPriority[left.category] - warningPriority[right.category])

  for (const alert of actionableWarnings) {
    if (items.length >= 2) break
    const target: AttentionTarget = alert.category === 'synchronization'
      ? 'curves'
      : alert.category === 'environment'
        ? 'alerts'
        : 'analysis'
    items.push({
      id: alert.id,
      title: alert.title,
      description: alert.message,
      target,
    })
  }

  return items.slice(0, 2)
}
