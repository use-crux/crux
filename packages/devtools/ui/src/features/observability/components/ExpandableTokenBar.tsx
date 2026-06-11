import { useState } from 'react'
import { ChevronDownIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
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
  'bg-(--qw-blue)',
  'bg-(--qw-ok)',
  'bg-(--qw-warn)',
  'bg-(--qw-iris)',
  'bg-(--qw-plum)',
  'bg-(--qw-crux)',
  'bg-(--qw-gold)',
  'bg-(--qw-blue)',
]

const BAR_COLORS = [
  'bg-(--qw-blue-soft)',
  'bg-(--qw-ok-soft)',
  'bg-(--qw-warn-soft)',
  'bg-(--qw-iris-soft)',
  'bg-(--qw-plum-soft)',
  'bg-(--qw-crux-soft)',
  'bg-(--qw-gold-soft)',
  'bg-(--qw-blue-soft)',
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
              <ChevronDownIcon
                className={cn('h-3 w-3 text-zinc-500 transition-transform duration-200', open && 'rotate-180')}
              />
            </span>
            <span className={cn('tabular-nums font-medium', exceedsBaseline ? 'text-(--qw-warn)' : 'text-zinc-300')}>
              {formatTokens(totalTokens)} tokens
              {baseline && (
                <span className="text-zinc-500 font-normal ml-1.5">/ avg {formatTokens(baseline.avgTokens)}</span>
              )}
            </span>
          </div>

          <div
            className={cn(
              'relative flex h-5 rounded overflow-hidden bg-zinc-800',
              exceedsBaseline && 'ring-1 ring-(--qw-warn-soft)',
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
                <TriangleAlertIcon className="h-3.5 w-3.5 text-(--qw-warn)" />
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
                <XIcon className="h-3.5 w-3.5 text-zinc-500" />
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
                  <span className="text-(--qw-warn) tabular-nums">
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
