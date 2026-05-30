import { useState } from 'react'
import type { InspectPart, DroppedContext, ExcludedContext } from '@/types'
import { cn } from '@/shared/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/components/ui/collapsible'

interface ExpandableTokenBarProps {
  parts: InspectPart[]
  droppedContexts: DroppedContext[]
  excludedContexts?: ExcludedContext[]
  totalTokens: number
  baseline?: { avgTokens: number }
  className?: string
}

const COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-indigo-500',
]

const BAR_COLORS = [
  'bg-blue-500/80',
  'bg-emerald-500/80',
  'bg-amber-500/80',
  'bg-purple-500/80',
  'bg-rose-500/80',
  'bg-cyan-500/80',
  'bg-orange-500/80',
  'bg-indigo-500/80',
]

function formatTokens(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return String(tokens)
}

export function ExpandableTokenBar({
  parts,
  droppedContexts,
  excludedContexts,
  totalTokens,
  baseline,
  className,
}: ExpandableTokenBarProps) {
  const [open, setOpen] = useState(false)

  if (totalTokens === 0) return null

  const activeParts = parts.filter((p) => !p.skipped && p.tokens > 0)
  const exceedsBaseline = baseline && totalTokens > baseline.avgTokens * 1.2

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn('space-y-2', className)}>
      {/* Compact bar (always visible) */}
      <CollapsibleTrigger className="w-full text-left">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400 flex items-center gap-1.5">
              Token breakdown
              <svg
                className={cn('h-3 w-3 text-zinc-500 transition-transform duration-200', open && 'rotate-180')}
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 4.5L6 7.5L9 4.5" />
              </svg>
            </span>
            <span className={cn('tabular-nums font-medium', exceedsBaseline ? 'text-amber-400' : 'text-zinc-300')}>
              {formatTokens(totalTokens)} tokens
              {baseline && (
                <span className="text-zinc-500 font-normal ml-1.5">/ avg {formatTokens(baseline.avgTokens)}</span>
              )}
            </span>
          </div>

          <div
            className={cn(
              'relative flex h-5 rounded overflow-hidden bg-zinc-800',
              exceedsBaseline && 'ring-1 ring-amber-500/40',
            )}
          >
            {activeParts.map((part, i) => {
              const width = (part.tokens / totalTokens) * 100
              if (width < 0.5) return null
              return (
                <div
                  key={part.source}
                  className={cn(COLORS[i % COLORS.length], 'relative group')}
                  style={{ width: `${width}%` }}
                  title={`${part.source}: ${part.tokens} tokens`}
                >
                  <div className="absolute inset-0 flex items-center justify-center text-[10px] text-white font-medium overflow-hidden whitespace-nowrap px-1">
                    {width > 8 ? part.source : ''}
                  </div>
                </div>
              )
            })}

            {/* Baseline indicator */}
            {baseline && baseline.avgTokens < totalTokens && (
              <div
                className="absolute top-0 bottom-0 w-px border-l border-dashed border-zinc-400/60"
                style={{
                  left: `${Math.min((baseline.avgTokens / totalTokens) * 100, 100)}%`,
                }}
                title={`Baseline avg: ${formatTokens(baseline.avgTokens)} tokens`}
              />
            )}
          </div>
        </div>
      </CollapsibleTrigger>

      {/* Expandable per-context breakdown */}
      <CollapsibleContent>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 divide-y divide-zinc-800/60">
          {/* Active parts */}
          {activeParts.map((part, i) => {
            const pct = (part.tokens / totalTokens) * 100
            return (
              <div key={part.source} className="px-3 py-2 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn('w-2 h-2 rounded-sm shrink-0', COLORS[i % COLORS.length])} />
                    <span className="text-zinc-200 truncate">{part.source}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span className="text-zinc-400 tabular-nums">{part.tokens.toLocaleString()}</span>
                    <span className="text-zinc-500 tabular-nums w-12 text-right">{pct.toFixed(1)}%</span>
                  </div>
                </div>
                {/* Proportional mini-bar */}
                <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={cn('h-full rounded-full', BAR_COLORS[i % BAR_COLORS.length])}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}

          {/* Skipped parts (in the parts array but skipped) */}
          {parts
            .filter((p) => p.skipped)
            .map((part) => (
              <div key={part.source} className="px-3 py-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-2 h-2 rounded-sm bg-zinc-700 shrink-0" />
                    <span className="text-zinc-500 truncate line-through">{part.source}</span>
                    <span className="text-zinc-600 text-[10px]">skipped</span>
                  </div>
                  <span className="text-zinc-600 tabular-nums shrink-0 ml-3">{part.tokens.toLocaleString()}</span>
                </div>
              </div>
            ))}

          {/* Dropped contexts */}
          {droppedContexts.length > 0 && (
            <div className="px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <svg className="h-3.5 w-3.5 text-amber-500/70" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a.75.75 0 0 1 .67.42l6.25 12.5A.75.75 0 0 1 14.25 15H1.75a.75.75 0 0 1-.67-1.08L7.33 1.42A.75.75 0 0 1 8 1ZM7.25 10V6.5h1.5V10h-1.5Zm0 1.5h1.5v1.25h-1.5V11.5Z" />
                </svg>
                <span>Dropped contexts ({droppedContexts.length})</span>
              </div>
              {droppedContexts.map((ctx) => (
                <div key={ctx.source} className="ml-5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-zinc-500 truncate">{ctx.source}</span>
                    <span className="text-zinc-600 text-[10px] shrink-0">priority {ctx.priority}</span>
                  </div>
                  <span className="text-zinc-600 tabular-nums shrink-0 ml-3">{ctx.tokens.toLocaleString()} tokens</span>
                </div>
              ))}
            </div>
          )}

          {/* Excluded contexts (when/match conditions) */}
          {excludedContexts && excludedContexts.length > 0 && (
            <div className="px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <svg className="h-3.5 w-3.5 text-zinc-500" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
                <span>Excluded contexts ({excludedContexts.length})</span>
              </div>
              {excludedContexts.map((ctx) => (
                <div key={ctx.source} className="ml-5 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-zinc-500 truncate line-through">{ctx.source}</span>
                  </div>
                  <span className="text-zinc-600 text-[10px] shrink-0 ml-3">{ctx.reason}</span>
                </div>
              ))}
            </div>
          )}

          {/* Baseline comparison footer */}
          {baseline && (
            <div className="px-3 py-2 flex items-center justify-between text-[11px]">
              <span className="text-zinc-500">Baseline average</span>
              <div className="flex items-center gap-2">
                <span className="text-zinc-400 tabular-nums">{formatTokens(baseline.avgTokens)} tokens</span>
                {exceedsBaseline && (
                  <span className="text-amber-400 tabular-nums">
                    +{((totalTokens / baseline.avgTokens - 1) * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
