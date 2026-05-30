import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDownIcon, CopyIcon, FileTextIcon, MessageSquareIcon, PuzzleIcon } from 'lucide-react'
import { JsonTree } from '@/shared/components/JsonTree'
import { cn } from '@/shared/lib/utils'
import { SectionErrorBoundary } from '@/qw/shell/SectionBoundary'
import type { ContextMeta, CorrelatedEvent } from '@/types'
import { formatTime, formatTokens, getEventColor, summarizeEvent, tryParseJson } from '../lib/span-detail-format'

/**
 * Span detail section.
 *
 * Wraps its body in a `SectionErrorBoundary` so a malformed span (bad
 * JSON, unexpected stream shape, missing usage object) only takes down
 * that one collapsible section instead of blanking the entire span
 * detail panel. Each Section gets `resetKey={title}` so collapsing/
 * re-expanding doesn't reset state, but errors clear cleanly when the
 * user navigates to a different span (title is the stable identity
 * inside a span's UI).
 */
export function Section({
  title,
  badge,
  children,
  defaultOpen = true,
  className,
}: {
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={cn('border-t border-zinc-800/80', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-5 py-2.5 text-left hover:bg-zinc-800/30 transition-colors"
      >
        <ChevronDownIcon className={cn('size-3.5 text-zinc-500 transition-transform', !open && '-rotate-90')} />
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">{title}</span>
        {badge}
      </button>
      {open && (
        <div className="px-5 pb-4 overflow-hidden min-w-0">
          <SectionErrorBoundary title={title} compact>
            {children}
          </SectionErrorBoundary>
        </div>
      )}
    </div>
  )
}

export function MetricPill({
  label,
  value,
  sub,
  className,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-0.5 bg-zinc-800/60 rounded-lg px-2.5 py-1.5 min-w-[70px]', className)}>
      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</span>
      <span className="text-sm font-medium tabular-nums text-zinc-100">{value}</span>
      {sub && <span className="text-[10px] text-zinc-500 tabular-nums">{sub}</span>}
    </div>
  )
}

const CHUNK_COLORS = [
  'bg-amber-500/20',
  'bg-sky-500/20',
  'bg-emerald-500/20',
  'bg-violet-500/20',
  'bg-rose-500/20',
  'bg-cyan-500/20',
  'bg-orange-500/20',
  'bg-teal-500/20',
  'bg-indigo-500/20',
  'bg-pink-500/20',
]

export function StreamChunksView({ chunks, isStreaming }: { chunks: string[]; isStreaming: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chunks.length])

  return (
    <div ref={scrollRef} className="rounded border border-zinc-800 max-h-96 overflow-y-auto">
      <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed p-3">
        {chunks.map((chunk, i) => (
          <span key={i} className={`${CHUNK_COLORS[i % CHUNK_COLORS.length]} rounded-sm`}>
            {chunk}
          </span>
        ))}
        {isStreaming && (
          <span className="inline-block w-[2px] h-[14px] bg-blue-400 animate-pulse ml-0.5 align-middle" />
        )}
      </pre>
    </div>
  )
}

const BREAKDOWN_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-indigo-500',
]

export function BudgetBreakdownBar({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((sum, [, v]) => sum + v, 0)
  if (total === 0) return null
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex h-2 rounded-full overflow-hidden bg-zinc-800">
        {entries.map(([source, tokens], i) => (
          <div
            key={source}
            className={cn(BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length], 'h-full')}
            style={{ width: `${(tokens / total) * 100}%` }}
            title={`${source}: ${tokens.toLocaleString()} tokens`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
        {entries.map(([source, tokens], i) => (
          <span key={source} className="flex items-center gap-1 text-[10px] text-zinc-500">
            <span className={cn('w-1.5 h-1.5 rounded-sm shrink-0', BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length])} />
            {source} <span className="tabular-nums text-zinc-600">{formatTokens(tokens)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

export function EventList({ events }: { events: CorrelatedEvent[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  return (
    <div className="p-5 space-y-0.5">
      {events.map((event) => {
        const hasExpandable =
          (event.eventType === 'blackboard:update' && event.data.snapshot != null) ||
          (event.eventType === 'tool:end' &&
            (event.data.result != null ||
              event.data.modelOutput != null ||
              event.data.modelOutputType != null ||
              event.data.error != null)) ||
          (event.eventType === 'delegate:complete' && event.data.durationMs != null) ||
          (event.eventType === 'handoff:prepare' && (event.data.inputSize != null || event.data.summary != null))
        const isExpanded = expanded.has(event.id)
        return (
          <div key={event.id}>
            <div
              className={cn(
                'flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-[11px] hover:bg-zinc-900/50 transition-colors',
                hasExpandable && 'cursor-pointer',
              )}
              onClick={hasExpandable ? () => toggle(event.id) : undefined}
            >
              <span className={cn('h-2 w-2 mt-1 shrink-0 rounded-full', getEventColor(event))} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500 tabular-nums shrink-0">{formatTime(event.timestamp)}</span>
                  <span className="font-mono text-zinc-400">{event.eventType}</span>
                  {hasExpandable && (
                    <ChevronDownIcon
                      className={cn('size-3 text-zinc-600 transition-transform', isExpanded && 'rotate-180')}
                    />
                  )}
                </div>
                <div className="text-zinc-500 truncate">{summarizeEvent(event)}</div>
                {event.eventType === 'handoff:prepare' && event.data.summary != null && (
                  <div className="text-zinc-600 italic truncate mt-0.5">{String(event.data.summary)}</div>
                )}
                {event.eventType === 'budget:check' && event.data.breakdown != null && (
                  <BudgetBreakdownBar breakdown={event.data.breakdown as Record<string, number>} />
                )}
              </div>
            </div>
            {hasExpandable && isExpanded && (
              <div className="ml-7 mt-1 mb-2">
                {event.eventType === 'blackboard:update' && event.data.snapshot != null && (
                  <JsonBlock data={event.data.snapshot} maxHeight="max-h-48" />
                )}
                {event.eventType === 'tool:end' && (
                  <>
                    {event.data.error != null && (
                      <div className="text-red-400 text-[11px] font-mono mb-1">{String(event.data.error)}</div>
                    )}
                    {event.data.result != null && (
                      <JsonBlock
                        data={
                          typeof event.data.result === 'string' ? tryParseJson(event.data.result) : event.data.result
                        }
                        maxHeight="max-h-48"
                      />
                    )}
                    {(event.data.modelOutput != null || event.data.modelOutputType != null) && (
                      <div className="mt-2 space-y-1">
                        <div className="text-[10px] uppercase tracking-wide text-zinc-600">
                          Model output
                          {event.data.modelOutputType != null && (
                            <span className="ml-1 normal-case text-zinc-500">
                              ({String(event.data.modelOutputType)})
                            </span>
                          )}
                          {typeof event.data.outputSize === 'number' &&
                            typeof event.data.modelOutputSize === 'number' && (
                              <span className="ml-1 normal-case text-zinc-500">
                                {event.data.outputSize}B → {event.data.modelOutputSize}B
                              </span>
                            )}
                        </div>
                        {event.data.modelOutputError != null && (
                          <div className="text-red-400 text-[11px] font-mono">
                            {String(event.data.modelOutputError)}
                          </div>
                        )}
                        {event.data.modelOutput != null && (
                          <JsonBlock data={event.data.modelOutput} maxHeight="max-h-48" />
                        )}
                      </div>
                    )}
                  </>
                )}
                {event.eventType === 'delegate:complete' && (
                  <div className="text-[11px] text-zinc-500 space-y-0.5">
                    <div>
                      Duration:{' '}
                      <span className="text-zinc-300 tabular-nums">{Number(event.data.durationMs ?? 0)}ms</span>
                    </div>
                    <div>
                      Handoff: <span className="text-zinc-400 font-mono">{String(event.data.handoffId ?? '-')}</span>
                    </div>
                    <div>
                      Data:{' '}
                      <span className="text-zinc-300 tabular-nums">
                        {Number(event.data.inputSize ?? 0)}B → {Number(event.data.outputSize ?? 0)}B
                      </span>
                    </div>
                  </div>
                )}
                {event.eventType === 'handoff:prepare' && (
                  <div className="text-[11px] text-zinc-500 space-y-0.5">
                    {event.data.fromAgent != null && event.data.toAgent != null && (
                      <div>
                        <span className="text-zinc-300">{String(event.data.fromAgent)}</span> →{' '}
                        <span className="text-zinc-300">{String(event.data.toAgent)}</span>
                      </div>
                    )}
                    <div>
                      Data:{' '}
                      <span className="text-zinc-300 tabular-nums">
                        {Number(event.data.inputSize ?? 0)}B → {Number(event.data.outputSize ?? 0)}B
                      </span>
                    </div>
                    {event.data.summary != null && (
                      <div className="text-zinc-600 italic mt-1">{String(event.data.summary)}</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Compute highlight ranges for injected input values in resolved text. */
export function computeHighlights(
  text: string,
  input: Record<string, unknown>,
  meta?: {
    inputSchema?: Record<string, unknown> | undefined
    isStatic?: boolean
  },
): Array<{ start: number; end: number }> {
  if (!meta || meta.isStatic === true || !meta.inputSchema) return []
  const props = (meta.inputSchema as { properties?: Record<string, unknown> }).properties
  if (!props || typeof props !== 'object') return []

  // Collect candidate values: only strings 8+ chars
  const candidates: Array<{ value: string }> = []
  for (const key of Object.keys(props)) {
    const val = input[key]
    if (typeof val === 'string' && val.length >= 8) {
      candidates.push({ value: val })
    }
  }
  if (candidates.length === 0) return []

  // Sort by length descending (longest first to avoid overlap)
  candidates.sort((a, b) => b.value.length - a.value.length)

  // Find all occurrences, marking claimed positions
  const claimed = new Set<number>()
  const ranges: Array<{ start: number; end: number }> = []

  for (const { value } of candidates) {
    let idx = 0
    while (true) {
      const found = text.indexOf(value, idx)
      if (found === -1) break
      const end = found + value.length
      // Check no overlap with already-claimed ranges
      let overlaps = false
      for (let i = found; i < end; i++) {
        if (claimed.has(i)) {
          overlaps = true
          break
        }
      }
      if (!overlaps) {
        ranges.push({ start: found, end })
        for (let i = found; i < end; i++) claimed.add(i)
      }
      idx = found + 1
    }
  }

  return ranges.sort((a, b) => a.start - b.start)
}

export function PartContent({
  text,
  highlights,
}: {
  text: string
  highlights?: Array<{ start: number; end: number }>
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > 300
  const displayText = expanded || !isLong ? text : text.slice(0, 300) + '…'
  const hasHighlights = highlights && highlights.length > 0

  // Split text into segments for highlighting
  const renderContent = () => {
    if (!hasHighlights) return displayText

    // Adjust highlights to display text bounds
    const displayLen = displayText.length
    const visibleHighlights = highlights!.filter((h) => h.start < displayLen)

    if (visibleHighlights.length === 0) return displayText

    const segments: Array<{ text: string; highlighted: boolean }> = []
    let pos = 0
    for (const h of visibleHighlights) {
      const start = Math.max(h.start, pos)
      const end = Math.min(h.end, displayLen)
      if (start > pos) {
        segments.push({
          text: displayText.slice(pos, start),
          highlighted: false,
        })
      }
      if (end > start) {
        segments.push({
          text: displayText.slice(start, end),
          highlighted: true,
        })
      }
      pos = end
    }
    if (pos < displayLen) {
      segments.push({ text: displayText.slice(pos), highlighted: false })
    }

    return segments.map((seg, i) =>
      seg.highlighted ? (
        <span key={i} className="bg-amber-500/10 text-amber-200 border-b border-dashed border-amber-500/30">
          {seg.text}
        </span>
      ) : (
        <span key={i}>{seg.text}</span>
      ),
    )
  }

  return (
    <div className="relative">
      {hasHighlights && (
        <div className="px-3 pt-1.5 flex items-center gap-1.5 text-[9px] text-zinc-600">
          <span className="inline-block w-3 h-0.5 bg-amber-500/30 border-b border-dashed border-amber-500/40" />
          injected from input
        </div>
      )}
      <pre className="px-3 py-2 text-[11px] text-zinc-400 leading-relaxed whitespace-pre-wrap break-words overflow-hidden bg-zinc-950/40 max-h-48 overflow-y-auto">
        {renderContent()}
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="absolute bottom-1 right-2 text-[10px] text-zinc-500 hover:text-zinc-300 bg-zinc-900 rounded px-1.5 py-0.5 border border-zinc-800"
        >
          {expanded ? 'collapse' : 'expand'}
        </button>
      )}
    </div>
  )
}

export function ContextPartCard({
  source,
  text,
  tokens,
  skipped,
  role,
  isPromptPart,
  isContext,
  ctxMeta,
  tokenBudget,
  onViewContext,
  highlights,
}: {
  source: string
  text: string
  tokens: number
  skipped: boolean
  role: 'system' | 'user'
  isPromptPart: boolean
  isContext: boolean
  ctxMeta?: ContextMeta
  tokenBudget?: number
  onViewContext?: () => void
  highlights?: Array<{ start: number; end: number }>
}) {
  const isUser = role === 'user'
  return (
    <div className="overflow-hidden min-w-0">
      <div
        className={cn(
          'rounded-lg border overflow-hidden',
          skipped ? 'border-zinc-800/40 opacity-60' : isUser ? 'border-cyan-500/20' : 'border-zinc-800/60',
        )}
      >
        {/* Part header */}
        <div className={cn('flex items-center gap-2 px-3 py-1.5', isUser ? 'bg-cyan-950/20' : 'bg-zinc-900/60')}>
          {isUser ? (
            <MessageSquareIcon className="size-3 text-cyan-400 shrink-0" />
          ) : isPromptPart ? (
            <FileTextIcon className="size-3 text-zinc-500 shrink-0" />
          ) : isContext ? (
            <PuzzleIcon className="size-3 text-violet-400 shrink-0" />
          ) : null}
          <span
            className={cn(
              'text-[10px] font-medium uppercase tracking-wider',
              isUser ? 'text-cyan-400' : 'text-zinc-600',
            )}
          >
            {role}
          </span>
          <span
            className={cn(
              'text-xs font-medium',
              skipped
                ? 'text-zinc-600 line-through'
                : isUser
                  ? 'text-cyan-300'
                  : isContext
                    ? 'text-violet-300'
                    : 'text-zinc-300',
            )}
          >
            {source}
          </span>
          {ctxMeta?.description && <span className="text-[10px] text-zinc-500 truncate">{ctxMeta.description}</span>}
          {onViewContext && (
            <button onClick={onViewContext} className="text-[10px] text-violet-400 hover:text-violet-300 shrink-0">
              view →
            </button>
          )}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {skipped && <span className="text-[9px] text-zinc-600 bg-zinc-800 rounded px-1">skipped</span>}
            {ctxMeta && <span className="text-[9px] text-zinc-600">priority {ctxMeta.priority}</span>}
            {ctxMeta && (
              <span
                className={cn(
                  'text-[9px] rounded px-1',
                  ctxMeta.isStatic ? 'text-zinc-500 bg-zinc-800' : 'text-amber-400/70 bg-amber-500/10',
                )}
              >
                {ctxMeta.isStatic ? 'static' : 'dynamic'}
              </span>
            )}
            <span className="text-[10px] text-zinc-600 tabular-nums">{tokens.toLocaleString()} tok</span>
            {tokens > 0 && tokenBudget && tokens / tokenBudget > 0.3 && (
              <span className="text-[10px] text-amber-500">⚠ {Math.round((tokens / tokenBudget) * 100)}%</span>
            )}
          </div>
        </div>
        {/* Part content (collapsible) */}
        {!skipped && text && <PartContent text={text} highlights={highlights} />}
      </div>
    </div>
  )
}

export function JsonBlock({ data, maxHeight = 'max-h-64' }: { data: unknown; maxHeight?: string }) {
  const [showRaw, setShowRaw] = useState(false)
  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2)

  return (
    <div className="relative group min-w-0 overflow-hidden">
      <div
        className={cn(
          maxHeight,
          'overflow-auto rounded-lg bg-zinc-950 p-3 font-mono text-xs border border-zinc-800/50',
        )}
      >
        {showRaw ? (
          <pre className="whitespace-pre-wrap text-zinc-300 break-all">{jsonStr}</pre>
        ) : (
          <JsonTree data={data} />
        )}
      </div>
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => setShowRaw(!showRaw)}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 bg-zinc-800 rounded px-1.5 py-0.5 border border-zinc-700"
        >
          {showRaw ? 'tree' : 'raw'}
        </button>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(jsonStr)
          }}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 bg-zinc-800 rounded px-1.5 py-0.5 border border-zinc-700"
        >
          <CopyIcon className="size-3" />
        </button>
      </div>
    </div>
  )
}
