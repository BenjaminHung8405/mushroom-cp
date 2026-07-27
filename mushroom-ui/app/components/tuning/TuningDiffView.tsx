import { ArrowRight, Equal, MoveDown, MoveUp } from 'lucide-react'

import type {
  TuningAdvisory,
  TuningConfigSnapshot,
} from '@/app/hooks/useTuningRecommendation'

interface TuningDiffViewProps {
  currentConfig: TuningConfigSnapshot
  suggestedConfig: TuningConfigSnapshot
  delta: TuningAdvisory['delta']
}

type TuningParameter = keyof TuningConfigSnapshot

interface ParameterDefinition {
  key: TuningParameter
  label: string
  friendlyLabel: string
  description: string
  /** When true, prefer "Mạnh hơn / Nhẹ hơn" over "Tăng / Giảm". */
  gainStyle?: boolean
  min: number
  max: number
}

const PARAMETERS: readonly ParameterDefinition[] = [
  {
    key: 'lamp_gain_scale',
    label: 'Lamp gain scale',
    friendlyLabel: 'Độ mạnh đèn sưởi',
    description: 'Hệ số nhân công suất đèn sưởi khi hệ thống cần tăng nhiệt độ.',
    gainStyle: true,
    min: 0.8,
    max: 1.2,
  },
  {
    key: 'mist_gain_scale',
    label: 'Mist gain scale',
    friendlyLabel: 'Độ mạnh phun sương',
    description: 'Hệ số nhân lượng phun sương khi hệ thống cần tăng độ ẩm.',
    gainStyle: true,
    min: 0.8,
    max: 1.2,
  },
  {
    key: 'mist_on_threshold',
    label: 'Mist ON threshold',
    friendlyLabel: 'Ngưỡng bật phun sương',
    description: 'Mức độ ẩm thiếu hụt tối thiểu để hệ thống bật phun sương.',
    min: 0.2,
    max: 0.35,
  },
  {
    key: 'mist_off_threshold',
    label: 'Mist OFF threshold',
    friendlyLabel: 'Ngưỡng tắt phun sương',
    description: 'Mức độ ẩm thiếu hụt tối đa để hệ thống ngừng phun sương.',
    min: 0.1,
    max: 0.2,
  },
] as const

/**
 * Shows the complete, server-generated configuration snapshot. Values are
 * rendered as React text nodes, so operator-facing data is never interpreted
 * as HTML.
 */
export function TuningDiffView({
  currentConfig,
  suggestedConfig,
  delta,
}: TuningDiffViewProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700/50">
      <table className="w-full min-w-[600px] text-left text-sm">
        <caption className="sr-only">
          So sánh cấu hình hiện tại với cấu hình tinh chỉnh được đề xuất
        </caption>
        <thead className="border-b border-slate-700/50 bg-slate-900/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">Tham số</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Hiện tại</th>
            <th scope="col" className="px-2 py-3" aria-label="Chuyển thành" />
            <th scope="col" className="px-4 py-3 text-right font-medium">Đề xuất</th>
            <th scope="col" className="px-4 py-3 text-right font-medium">Thay đổi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {PARAMETERS.map((parameter) => (
            <DiffRow
              key={parameter.key}
              definition={parameter}
              currentValue={currentConfig[parameter.key]}
              suggestedValue={suggestedConfig[parameter.key]}
              isChanged={Object.prototype.hasOwnProperty.call(delta, parameter.key)}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DiffRow({
  definition,
  currentValue,
  suggestedValue,
  isChanged,
}: {
  definition: ParameterDefinition
  currentValue: number
  suggestedValue: number
  isChanged: boolean
}) {
  const difference = suggestedValue - currentValue
  const direction = isChanged && difference !== 0
    ? difference > 0 ? 'increase' : 'decrease'
    : 'unchanged'
  const status = statusFor(direction, difference, definition.gainStyle ?? false)

  return (
    <tr className="bg-slate-950/20">
      <th scope="row" className="px-4 py-3 font-medium text-foreground" title={definition.description}>
        <div>{definition.friendlyLabel}</div>
        <details className="mt-1 text-xs font-normal text-muted-foreground">
          <summary className="cursor-pointer select-none text-[11px] text-slate-400 hover:text-slate-200">
            Chi tiết kỹ thuật
          </summary>
          <p className="mt-1 font-mono text-[11px] text-slate-500">{definition.label}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Giới hạn cứng: {formatValue(definition.min)} – {formatValue(definition.max)}
          </p>
        </details>
      </th>
      <td className="px-4 py-3 text-right font-mono text-slate-200">
        {formatValue(currentValue)}
      </td>
      <td className="px-2 py-3 text-center text-muted-foreground">
        <ArrowRight className="mx-auto size-4" aria-hidden="true" />
      </td>
      <td className="px-4 py-3 text-right font-mono font-semibold text-foreground">
        {formatValue(suggestedValue)}
      </td>
      <td className="px-4 py-3 text-right">
        <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${status.className}`}>
          <status.Icon className="size-3.5" aria-hidden="true" />
          {status.label}
        </span>
      </td>
    </tr>
  )
}

function statusFor(
  direction: 'increase' | 'decrease' | 'unchanged',
  difference: number,
  gainStyle: boolean,
) {
  switch (direction) {
    case 'increase':
      return {
        Icon: MoveUp,
        label: gainStyle
          ? `Mạnh hơn ${formatDifference(difference)}`
          : `Tăng ${formatDifference(difference)}`,
        className: 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30',
      }
    case 'decrease':
      return {
        Icon: MoveDown,
        label: gainStyle
          ? `Nhẹ hơn ${formatDifference(Math.abs(difference))}`
          : `Giảm ${formatDifference(Math.abs(difference))}`,
        className: 'bg-amber-500/10 text-amber-200 ring-1 ring-amber-500/30',
      }
    case 'unchanged':
      return {
        Icon: Equal,
        label: 'Không đổi',
        className: 'bg-slate-700/50 text-slate-200 ring-1 ring-slate-600/70',
      }
  }
}

function formatValue(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : 'Không hợp lệ'
}

function formatDifference(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : 'Không hợp lệ'
}
