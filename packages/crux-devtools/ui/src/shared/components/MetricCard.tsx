import { cn } from '@/shared/lib/utils'
import { TrendSparkline } from './TrendSparkline'

interface MetricCardProps {
  label: string
  value: string | number
  sparklineData?: number[]
  trend?: { direction: 'up' | 'down' | 'stable'; percent: number }
  status?: 'ok' | 'warning' | 'critical'
  onClick?: () => void
  className?: string
}

const STATUS_BORDER: Record<string, string> = {
  ok: 'border-l-emerald-500',
  warning: 'border-l-amber-500',
  critical: 'border-l-red-500',
}

const TREND_CONFIG: Record<string, { arrow: string; color: string; sparkColor: string }> = {
  up: {
    arrow: '\u2191',
    color: 'text-emerald-400 bg-emerald-400/10',
    sparkColor: 'emerald',
  },
  down: {
    arrow: '\u2193',
    color: 'text-red-400 bg-red-400/10',
    sparkColor: 'red',
  },
  stable: {
    arrow: '\u2192',
    color: 'text-zinc-400 bg-zinc-400/10',
    sparkColor: 'zinc',
  },
}

export function MetricCard({ label, value, sparklineData, trend, status, onClick, className }: MetricCardProps) {
  const borderColor = status ? STATUS_BORDER[status] : 'border-l-zinc-700'
  const trendCfg = trend ? TREND_CONFIG[trend.direction] : null

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick()
            }
          : undefined
      }
      className={cn(
        'border border-zinc-800 bg-zinc-900 p-4 border-l-[3px]',
        borderColor,
        onClick && 'hover:bg-zinc-800/50 cursor-pointer transition-colors',
        className,
      )}
    >
      <div className="text-xs text-zinc-500 uppercase tracking-wider">{label}</div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-2xl font-bold tabular-nums text-zinc-100 leading-tight">{value}</div>

          {trendCfg && trend && (
            <span
              className={cn(
                'mt-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
                trendCfg.color,
              )}
            >
              {trendCfg.arrow} {trend.percent.toFixed(1)}%
            </span>
          )}
        </div>

        {sparklineData && sparklineData.length >= 2 && (
          <TrendSparkline data={sparklineData} width={80} height={32} color={trendCfg?.sparkColor ?? 'emerald'} />
        )}
      </div>
    </div>
  )
}
