import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  XCircle,
} from 'lucide-react'

export type TuningCommandState = 'PENDING' | 'IN_SYNC' | 'REJECTED' | 'TIMEOUT'

interface TuningStatusBadgeProps {
  /**
   * Durable state from the validated API/SSE flow. TIMEOUT is a local waiting
   * state and must not be treated as a rejected command by the backend.
   */
  state: TuningCommandState
  /** Device-provided or API-provided rejection detail, when available. */
  rejectionReason?: string | null
}

const STATUS_CONTENT: Record<
  TuningCommandState,
  { label: string; className: string; Icon: typeof LoaderCircle; isPending?: boolean }
> = {
  PENDING: {
    label: 'Đang chờ thiết bị xác nhận',
    className: 'border-cyan-500/30 bg-cyan-950/30 text-cyan-100',
    Icon: LoaderCircle,
    isPending: true,
  },
  IN_SYNC: {
    label: 'Thiết bị đã xác nhận',
    className: 'border-emerald-500/30 bg-emerald-950/30 text-emerald-100',
    Icon: CheckCircle2,
  },
  REJECTED: {
    label: 'Thiết bị chưa áp dụng được đề xuất',
    className: 'border-red-500/30 bg-red-950/30 text-red-100',
    Icon: XCircle,
  },
  TIMEOUT: {
    label: 'Thiết bị đang phản hồi chậm',
    className: 'border-amber-500/30 bg-amber-950/30 text-amber-100',
    Icon: AlertTriangle,
  },
}

/**
 * Displays the command's durable synchronization state. A successful HTTP
 * response only creates PENDING work; callers must pass IN_SYNC exclusively
 * after receiving its validated durable API/SSE transition.
 */
export function TuningStatusBadge({
  state,
  rejectionReason = null,
}: TuningStatusBadgeProps) {
  const { label, className, Icon, isPending } = STATUS_CONTENT[state]

  return (
    <div
      role={state === 'PENDING' ? 'status' : 'alert'}
      aria-live={state === 'PENDING' ? 'polite' : 'assertive'}
      className={`rounded-md border px-3 py-2 text-sm ${className}`}
    >
      <div className="flex items-center gap-2 font-medium">
        <Icon
          className={`size-4 shrink-0 ${isPending ? 'animate-spin' : ''}`}
          aria-hidden="true"
        />
        <span>{label}</span>
      </div>
      {state === 'REJECTED' && rejectionReason && (
        <p className="mt-1 pl-6 text-xs leading-5">Lý do: {rejectionReason}</p>
      )}
      {state === 'TIMEOUT' && (
        <p className="mt-1 pl-6 text-xs leading-5">
          Lệnh vẫn đang chờ phản hồi bền vững từ thiết bị.
        </p>
      )}
    </div>
  )
}
