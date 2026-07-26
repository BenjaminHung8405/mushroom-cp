import { AlertTriangle, CircleOff, WifiOff } from 'lucide-react'

import type { TuningRecommendationBlockReason } from '@/app/hooks/useTuningRecommendation'

interface CoverageWarningProps {
  blockReason: TuningRecommendationBlockReason | null
  detail?: string | null
}

interface WarningContent {
  title: string
  description: string
  Icon: typeof AlertTriangle
}

const WARNING_CONTENT: Record<TuningRecommendationBlockReason, WarningContent> = {
  INSUFFICIENT_DATA: {
    title: 'Chưa đủ dữ liệu tin cậy',
    description:
      'Hệ thống chưa thể xác nhận đủ độ phủ và số mẫu hợp lệ để đưa ra đề xuất an toàn.',
    Icon: AlertTriangle,
  },
  DEVICE_OFFLINE: {
    title: 'Thiết bị chưa trực tuyến',
    description:
      'Không thể xác nhận tín hiệu telemetry mới nhất của thiết bị. Hãy kiểm tra kết nối rồi thử lại.',
    Icon: WifiOff,
  },
  NO_SUGGESTION: {
    title: 'Chưa cần điều chỉnh',
    description:
      'Các chỉ số hiện tại không kích hoạt quy tắc tạo đề xuất cấu hình.',
    Icon: CircleOff,
  },
  CONFLICT: {
    title: 'Các quy tắc đang mâu thuẫn',
    description:
      'Hệ thống không tự chọn giữa các thay đổi trái chiều; cần người vận hành xem xét thêm.',
    Icon: AlertTriangle,
  },
}

/** Returns whether the operator must be prevented from confirming a command. */
export function isTuningRecommendationBlocked(
  blockReason: TuningRecommendationBlockReason | null,
): boolean {
  return blockReason !== null
}

/**
 * Fail-safe explanation for every backend recommendation block. The optional
 * server detail is rendered as a React text node, never as HTML.
 */
export function CoverageWarning({ blockReason, detail = null }: CoverageWarningProps) {
  if (blockReason === null) {
    return null
  }

  const { title, description, Icon } = WARNING_CONTENT[blockReason]
  const safeDetail = detail?.trim()

  return (
    <div
      role="alert"
      className="rounded-md border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100"
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-1 leading-5">{safeDetail || description}</p>
        </div>
      </div>
    </div>
  )
}
