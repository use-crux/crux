import type { BudgetSnapshotData } from '@/types'
import { fmt } from '@/shared/components/ui-atoms'

export function BudgetGauge({ budget }: { budget: BudgetSnapshotData }) {
  const total = budget.used + budget.available
  const pct = total > 0 ? (budget.used / total) * 100 : 0
  const color =
    budget.level === 'critical' ? 'text-red-400' : budget.level === 'warning' ? 'text-amber-400' : 'text-emerald-400'
  const strokeColor = budget.level === 'critical' ? '#f87171' : budget.level === 'warning' ? '#fbbf24' : '#34d399'

  const r = 36
  const circ = 2 * Math.PI * r
  const arc = circ * 0.75 // 270 degrees
  const filled = arc * (pct / 100)

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 flex items-center gap-4">
      <svg width="88" height="88" viewBox="0 0 88 88" className="shrink-0">
        <circle
          cx="44"
          cy="44"
          r={r}
          fill="none"
          stroke="#27272a"
          strokeWidth="6"
          strokeDasharray={`${arc} ${circ}`}
          strokeDashoffset="0"
          strokeLinecap="round"
          transform="rotate(135 44 44)"
        />
        <circle
          cx="44"
          cy="44"
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth="6"
          strokeDasharray={`${filled} ${circ}`}
          strokeDashoffset="0"
          strokeLinecap="round"
          transform="rotate(135 44 44)"
          className="transition-all duration-500"
        />
        <text x="44" y="42" textAnchor="middle" className={`text-sm font-semibold ${color}`} fill="currentColor">
          {Math.round(pct)}%
        </text>
        <text x="44" y="56" textAnchor="middle" className="text-[9px] text-zinc-500" fill="#71717a">
          {fmt(budget.used, 'tok')} / {fmt(budget.used + budget.available, 'tok')}
        </text>
      </svg>
      <div>
        <div className="text-xs text-zinc-500 uppercase tracking-wide">Token Budget</div>
        <div className={`text-lg font-semibold ${color} capitalize`}>{budget.level}</div>
        {budget.breakdown && Object.keys(budget.breakdown).length > 0 && (
          <div className="mt-1 space-y-0.5">
            {Object.entries(budget.breakdown)
              .slice(0, 4)
              .map(([src, tok]) => (
                <div key={src} className="text-[10px] text-zinc-500">
                  <span className="text-zinc-400">{src}</span>: {fmt(tok, 'tok')}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Compact inline budget indicator for the timeline stats bar. */
export function InlineBudgetGauge({ budget }: { budget: BudgetSnapshotData }) {
  const total = budget.used + budget.available
  const pct = total > 0 ? Math.round((budget.used / total) * 100) : 0
  const color =
    budget.level === 'critical' ? 'text-red-400' : budget.level === 'warning' ? 'text-amber-400' : 'text-emerald-400'
  const barColor =
    budget.level === 'critical' ? 'bg-red-500' : budget.level === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-zinc-500 uppercase">Budget</span>
      <span className={`text-xs font-medium capitalize ${color}`}>{budget.level}</span>
      <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="text-[10px] text-zinc-500 tabular-nums">{pct}%</span>
    </div>
  )
}
