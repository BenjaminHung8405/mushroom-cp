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

const BACKEND_ENGLISH_DETAILS = new Set([
  'No valid KPI data is available for the requested observation window.',
])

/**
 * Accept operator-facing details only when they contain Vietnamese diacritics.
 * All backend English strings are ASCII, so the presence of any non-ASCII code
 * point is a strong indicator that the payload was localised in Vietnamese.
 */
export function isVietnameseText(value: string): boolean {
  // Any non-ASCII code point implies a localised (Vietnamese) payload since
  // backend English strings are ASCII-only. We inspect char codes directly to
  // avoid a control-character regex (which upsets the linter).
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 127) return true
  }
  return false
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
  const candidateDetail = detail?.trim() ?? ''
  const safeDetail =
    candidateDetail &&
    !BACKEND_ENGLISH_DETAILS.has(candidateDetail) &&
    isVietnameseText(candidateDetail)
      ? candidateDetail
      : null

  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-500/30 bg-amber-950/15 px-3 py-2.5 text-sm text-amber-100"
    >
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{title}</p>
          <p className="mt-0.5 leading-5">{safeDetail || description}</p>
        </div>
      </div>
    </div>
  )
}
