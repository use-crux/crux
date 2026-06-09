import { cn } from '@/shared/lib/utils'
import { fmt } from '@/shared/components/ui-atoms'

interface CostTreemapProps {
  inputCost: number
  outputCost: number
  cacheCost?: number
  totalCost: number
  className?: string
}

const segments = [
  {
    key: 'input',
    label: 'Input',
    bg: 'bg-(--qw-blue-soft)',
    text: 'text-(--qw-blue)',
    border: 'border-(--qw-blue-line)',
  },
  {
    key: 'output',
    label: 'Output',
    bg: 'bg-(--qw-ok-soft)',
    text: 'text-(--qw-ok)',
    border: 'border-(--qw-ok-soft)',
  },
  {
    key: 'cache',
    label: 'Cache',
    bg: 'bg-(--qw-warn-soft)',
    text: 'text-(--qw-warn)',
    border: 'border-(--qw-warn-soft)',
  },
] as const

export function CostTreemap({ inputCost, outputCost, cacheCost, totalCost, className }: CostTreemapProps) {
  const costs: Record<string, number> = {
    input: inputCost,
    output: outputCost,
    cache: cacheCost ?? 0,
  }

  const visible = segments.filter((s) => costs[s.key] > 0)
  if (visible.length === 0) return null

  const total = totalCost || Object.values(costs).reduce((a, b) => a + b, 0) || 1

  return (
    <div className={cn('flex h-14 gap-px overflow-hidden rounded border border-zinc-800', className)}>
      {visible.map((seg) => {
        const cost = costs[seg.key]
        const pct = Math.max((cost / total) * 100, 8)
        return (
          <div
            key={seg.key}
            className={cn('flex flex-col justify-center px-2.5 border-l first:border-l-0', seg.bg, seg.border)}
            style={{ width: `${pct}%` }}
          >
            <span className="truncate text-[10px] text-zinc-500">{seg.label}</span>
            <span className={cn('truncate text-xs font-medium tabular-nums', seg.text)}>
              {fmt(cost, '$')}
              <span className="ml-1 text-[10px] font-normal text-zinc-600">{((cost / total) * 100).toFixed(0)}%</span>
            </span>
          </div>
        )
      })}
    </div>
  )
}
