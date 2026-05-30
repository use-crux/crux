import { lazy, Suspense, useState, useMemo, useCallback, useRef, useEffect } from 'react'
import type { SpanNode } from '@/features/observability/lib/span-tree'
import type { CorrelatedEvent, Trace, RuntimeFlowRun, JudgeEventData, ContextMeta, PromptMeta } from '@/types'
import { useResolvedSource } from '@/shared/hooks/useResolvedSource'
import { JsonTree } from '@/shared/components/JsonTree'
import { RequestMap } from './RequestMap'
import { CostTreemap } from './CostTreemap'
import { SkeletonCard } from '@/shared/components/Skeleton'

// FlowWaterfall + SessionCanvas drag in @xyflow/react and its CSS. Only
// the flow / session tabs render them; lazy-loading keeps the default
// inspect tab cheap to mount.
const FlowWaterfall = lazy(() =>
  import('./FlowWaterfall').then((m) => ({ default: m.FlowWaterfall })),
)
const SessionCanvas = lazy(() =>
  import('./SessionCanvas').then((m) => ({ default: m.SessionCanvas })),
)
import {
  CodeBlock,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockActions,
  CodeBlockCopyButton,
} from '@/shared/components/ai-elements/code-block'
import { Tool, ToolContent } from '@/shared/components/ai-elements/tool'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/shared/components/ui/tabs'
import { CollapsibleTrigger } from '@/shared/components/ui/collapsible'
import { Badge } from '@/shared/components/ui/badge'
import {
  WrenchIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CopyIcon,
  AlertTriangleIcon,
  ArrowRightIcon,
  MessageSquareIcon,
  UserIcon,
  BotIcon,
  FileTextIcon,
  LinkIcon,
  PuzzleIcon,
  ExternalLinkIcon,
  XCircleIcon,
} from 'lucide-react'
import { classifyError } from '@/shared/lib/classify-error'
import { cn } from '@/shared/lib/utils'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useTraceFeedback } from '../hooks/useTraceFeedback'

// ─────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────

import {
  EVENT_COLORS,
  FINISH_REASON_STYLES,
  HANDOFF_KIND_STYLES,
  ROLE_STYLES,
  STATUS_COLORS,
  formatCost,
  formatDuration,
  formatTime,
  formatTokens,
  getEventColor,
  summarizeEvent,
  tryParseJson,
} from '../lib/span-detail-format'
import { collectTraceNodes, collectTraces, countKind, sumField } from '../lib/span-node-aggregates'
import { buildDelegateExecutionMap, buildToolExecutionMap } from '../lib/span-detail-trace'

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

import {
  ContextPartCard,
  EventList,
  JsonBlock,
  MetricPill,
  Section,
  StreamChunksView,
  computeHighlights,
} from './SpanDetailAtoms'

// ─────────────────────────────────────────────────────────────────
// Trace Detail (the main content for a trace span)
// ─────────────────────────────────────────────────────────────────

function TraceSpanDetail({
  trace,
  correlatedEvents,
  judgeEvents,
  contexts,
  prompts,
}: {
  trace: Trace
  correlatedEvents: CorrelatedEvent[]
  judgeEvents: JudgeEventData[]
  contexts?: ContextMeta[]
  prompts?: PromptMeta[]
}) {
  const { navigate } = useNavigation()
  const resolvedSource = useResolvedSource(trace.source)
  const { feedbackStatus, recordFeedback } = useTraceFeedback(trace.traceId)

  // Scroll-to refs for RequestMap → ContextPartCard linking
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const [highlightedSource, setHighlightedSource] = useState<string | null>(null)
  const handleSegmentClick = useCallback((source: string) => {
    const el = cardRefs.current.get(source)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      setHighlightedSource(source)
      setTimeout(() => setHighlightedSource(null), 1500)
    }
  }, [])

  // Build lookup for context metadata by source pattern
  const contextLookup = useMemo(() => {
    if (!contexts) return new Map<string, ContextMeta>()
    const map = new Map<string, ContextMeta>()
    for (const ctx of contexts) {
      if (ctx.id) map.set(`context:${ctx.id}`, ctx)
    }
    return map
  }, [contexts])

  // Find prompt definition for this trace
  const promptDef = useMemo(() => {
    if (!prompts || !trace.promptId) return null
    return prompts.find((p) => p.id === trace.promptId) ?? null
  }, [prompts, trace.promptId])
  const usage = trace.result?.usage
  const cost = trace.result?.cost
  const hasToolCalls = (trace.result?.toolCalls?.length ?? 0) > 0
  const hasError = trace.status === 'error' && trace.error
  const roleStyle = trace.role ? ROLE_STYLES[trace.role] : null
  const shortModel = trace.model !== 'resolve-only' ? trace.model.replace(/^[^/]+\//, '') : null

  const inputTokens = usage?.inputTokens ?? 0
  const outputTokens = usage?.outputTokens ?? 0
  const cacheTokens = (usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0)
  const totalTokensForCost = inputTokens + outputTokens + cacheTokens || 1

  const traceJudgeEvents = useMemo(
    () => judgeEvents.filter((j) => j.traceId === trace.traceId),
    [judgeEvents, trace.traceId],
  )
  const toolExecMap = useMemo(() => buildToolExecutionMap(correlatedEvents), [correlatedEvents])
  const delegateExecMap = useMemo(() => buildDelegateExecutionMap(correlatedEvents), [correlatedEvents])

  // Compute input-value highlights for each part (dynamic contexts only).
  // Each part only highlights fields from its OWN inputSchema — not all input fields.
  const partHighlights = useMemo(() => {
    if (!trace.input || !trace.inspect) return new Map<string, Array<{ start: number; end: number }>>()
    const map = new Map<string, Array<{ start: number; end: number }>>()

    // Collect all field names claimed by contexts so we can exclude them for prompt parts
    const contextClaimedFields = new Set<string>()
    for (const part of trace.inspect.system.parts) {
      if (part.source === 'prompt') continue
      const ctxMeta = contextLookup.get(part.source)
      const ctxProps = (ctxMeta?.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties
      if (ctxProps && typeof ctxProps === 'object') {
        for (const key of Object.keys(ctxProps)) contextClaimedFields.add(key)
      }
    }

    // Build a prompt-only schema: merged schema minus context-claimed fields
    const promptOnlySchema = promptDef?.inputSchema
      ? (() => {
          const mergedProps = (promptDef.inputSchema as { properties?: Record<string, unknown> }).properties
          if (!mergedProps || typeof mergedProps !== 'object') return undefined
          const ownProps: Record<string, unknown> = {}
          for (const [key, val] of Object.entries(mergedProps)) {
            if (!contextClaimedFields.has(key)) ownProps[key] = val
          }
          return Object.keys(ownProps).length > 0 ? { properties: ownProps } : undefined
        })()
      : undefined

    for (const part of trace.inspect.system.parts) {
      const ctxMeta = contextLookup.get(part.source)
      if (part.source === 'prompt') {
        // Prompt's own system text — only highlight prompt's own input fields
        if (promptOnlySchema) {
          map.set(
            part.source,
            computeHighlights(part.text, trace.input, {
              inputSchema: promptOnlySchema,
              isStatic: false,
            }),
          )
        }
      } else if (ctxMeta) {
        // Context part — only highlight fields this context declares
        map.set(part.source, computeHighlights(part.text, trace.input, ctxMeta))
      }
    }
    // User prompt — uses prompt's own fields (not context fields)
    if (trace.inspect.prompt?.text && promptOnlySchema) {
      map.set(
        'user prompt',
        computeHighlights(trace.inspect.prompt.text, trace.input, {
          inputSchema: promptOnlySchema,
          isStatic: false,
        }),
      )
    }
    return map
  }, [trace.input, trace.inspect, contextLookup, promptDef])

  const eventCount = correlatedEvents.length
  const scoreCount = traceJudgeEvents.length

  // Dynamic tabs
  const tabs = useMemo(() => {
    const t: { id: string; label: string; badge?: number }[] = [{ id: 'info', label: 'Info' }]
    if (scoreCount > 0) t.push({ id: 'scores', label: 'Scores', badge: scoreCount })
    t.push({ id: 'attributes', label: 'Attributes' })
    if (eventCount > 0) t.push({ id: 'events', label: 'Events', badge: eventCount })
    return t
  }, [eventCount, scoreCount])

  return (
    <div className="min-w-0 overflow-hidden">
      {/* Header */}
      <div className="border-b border-zinc-800 px-5 pb-3 pt-4">
        <div className="flex items-center gap-2 mb-2 min-w-0">
          <span className={cn('w-2 h-2 rounded-full shrink-0', STATUS_COLORS[trace.status])} />
          {trace.promptId ? (
            <button
              onClick={() => navigate({ view: 'library-catalog', promptId: trace.promptId! })}
              className="text-sm font-semibold text-zinc-100 truncate hover:text-cyan-300 transition-colors flex items-center gap-1"
            >
              <FileTextIcon className="size-3.5 text-zinc-500 shrink-0" />
              {trace.promptId}
            </button>
          ) : (
            <h2 className="text-sm font-semibold text-zinc-100 truncate">unnamed</h2>
          )}
          {roleStyle && (
            <span
              className={cn(
                'rounded border px-1.5 py-0.5 text-[10px] font-medium shrink-0',
                roleStyle.bg,
                roleStyle.text,
              )}
            >
              {roleStyle.label}
            </span>
          )}
          {shortModel && <span className="text-[10px] font-mono text-zinc-500 shrink-0">{shortModel}</span>}
          {trace.result?.finishReason && (
            <span
              className={cn(
                'rounded border px-1.5 py-0.5 text-[10px] shrink-0',
                FINISH_REASON_STYLES[trace.result.finishReason] ?? 'text-zinc-400 bg-zinc-800 border-zinc-700',
              )}
            >
              {trace.result.finishReason}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {feedbackStatus === 'saved' && <span className="text-[10px] text-emerald-400">Feedback saved</span>}
            {feedbackStatus === 'error' && <span className="text-[10px] text-red-400">Feedback failed</span>}
            <button
              type="button"
              disabled={feedbackStatus === 'saving'}
              onClick={() => void recordFeedback(1)}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
              title="Record positive quality feedback for this trace"
            >
              <MessageSquareIcon className="size-3 text-emerald-400" />
              Good
            </button>
            <button
              type="button"
              disabled={feedbackStatus === 'saving'}
              onClick={() => void recordFeedback(-1)}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
              title="Record issue feedback for this trace"
            >
              <MessageSquareIcon className="size-3 text-red-400" />
              Issue
            </button>
          </div>
        </div>

        {/* Source location */}
        {(resolvedSource ?? trace.source) &&
          (() => {
            const src = resolvedSource ?? trace.source!
            const filename = src.file.replace(/^.*\//, '')
            return (
              <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-mono">
                {src.function && <span className="text-zinc-400">{src.function}</span>}
                <span
                  className={resolvedSource?.resolved ? 'text-zinc-500' : 'text-zinc-600'}
                  title={`${src.file}:${src.line}`}
                >
                  {filename}:{src.line}
                </span>
              </div>
            )
          })()}

        {/* Context linking chips */}
        {(trace.sessionId || trace.flowId || trace.parentTraceId) && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {trace.sessionId && (
              <button
                onClick={() => navigate({ view: 'runs', groupBy: 'session' })}
                className="inline-flex items-center gap-1 border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700 transition-colors rounded"
              >
                <LinkIcon className="size-2.5 text-zinc-500" />
                <span className="text-zinc-500">Session</span> {trace.sessionId.slice(0, 8)}
              </button>
            )}
            {trace.flowId && (
              <button
                onClick={() => navigate({ view: 'runs', groupBy: 'session' })}
                className="inline-flex items-center gap-1 border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700 transition-colors rounded"
              >
                <LinkIcon className="size-2.5 text-violet-500" />
                <span className="text-zinc-500">Flow</span> {trace.flowId.slice(0, 8)}
              </button>
            )}
            {trace.parentTraceId && (
              <button
                onClick={() => navigate({ view: 'run-detail', traceId: trace.parentTraceId! })}
                className="inline-flex items-center gap-1 border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700 transition-colors rounded"
              >
                <LinkIcon className="size-2.5 text-zinc-500" />
                <span className="text-zinc-500">Parent</span> {trace.parentTraceId.slice(0, 8)}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          <MetricPill label="Duration" value={formatDuration(trace.durationMs)} />
          {trace.streaming?.ttftMs != null && (
            <MetricPill
              label="TTFT"
              value={
                <span
                  className={
                    trace.streaming.ttftMs < 200
                      ? 'text-emerald-300'
                      : trace.streaming.ttftMs < 500
                        ? 'text-amber-300'
                        : 'text-red-300'
                  }
                >
                  {trace.streaming.ttftMs}ms
                </span>
              }
              sub={
                trace.streaming.tokensPerSecond != null
                  ? `${trace.streaming.tokensPerSecond.toFixed(1)} tok/s`
                  : undefined
              }
            />
          )}
          {usage?.totalTokens != null && (
            <MetricPill
              label="Tokens"
              value={usage.totalTokens.toLocaleString()}
              sub={`${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out`}
            />
          )}
          {cost != null && cost > 0 && (
            <MetricPill label="Cost" value={<span className="text-emerald-300">{formatCost(cost)}</span>} />
          )}
        </div>
      </div>

      {/* Tabbed content */}
      <Tabs defaultValue="info" className="w-full min-w-0 overflow-hidden">
        <TabsList className="w-full justify-start rounded-none border-b border-zinc-800 bg-transparent px-5 h-9">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-400 data-[state=active]:bg-transparent data-[state=active]:shadow-none text-xs px-3 py-1.5"
            >
              {tab.label}
              {tab.badge != null && (
                <span className="ml-1 text-[10px] tabular-nums text-zinc-600 bg-zinc-800 rounded-full px-1.5">
                  {tab.badge}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ─── Info Tab ─── */}
        <TabsContent value="info" className="mt-0">
          {/* Error */}
          {hasError && (
            <Section title="Error" defaultOpen={true} className="border-t-0">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {(() => {
                    const cls = classifyError(trace.error!.message)
                    return (
                      <>
                        <span
                          className={cn('text-[10px] px-2 py-0.5 rounded border font-medium', cls.bgColor, cls.color)}
                        >
                          {cls.label}
                          {cls.retryable ? ' ↻' : ''}
                        </span>
                        {trace.error?.statusCode && (
                          <span className="text-[10px] text-zinc-600 font-mono">HTTP {trace.error.statusCode}</span>
                        )}
                      </>
                    )
                  })()}
                </div>
                <div className="rounded-lg border border-red-900/40 bg-red-950/30 p-3 text-sm text-red-300 font-mono leading-relaxed overflow-hidden min-w-0 break-words">
                  {trace.error!.message}
                </div>
                {trace.error!.stack && (
                  <details className="group">
                    <summary className="text-[10px] text-zinc-600 cursor-pointer hover:text-zinc-400 select-none">
                      Stack trace
                    </summary>
                    <pre className="mt-1.5 rounded-lg border border-zinc-800/60 bg-zinc-950/50 p-3 text-[11px] text-zinc-500 font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                      {trace.error!.stack}
                    </pre>
                  </details>
                )}
              </div>
            </Section>
          )}

          {/* Routing — show when router:select or cascade:complete events are correlated */}
          {(() => {
            const routerEvent = correlatedEvents.find((e) => e.eventType === 'router:select')
            const cascadeEvent = correlatedEvents.find((e) => e.eventType === 'cascade:complete')
            const cascadeTiers = correlatedEvents.filter((e) => e.eventType === 'cascade:tier')
            const budgetEvent = correlatedEvents.find((e) => e.eventType === 'budget:exceeded')

            if (!routerEvent && !cascadeEvent) return null

            return (
              <Section
                title="Routing"
                defaultOpen={true}
                className={hasError ? '' : 'border-t-0'}
                badge={
                  budgetEvent ? (
                    <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                      Budget exceeded
                    </span>
                  ) : undefined
                }
              >
                <div className="space-y-3">
                  {/* Router classification */}
                  {routerEvent && (
                    <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Router</span>
                        <span
                          className={cn(
                            'text-[10px] rounded border px-1.5 py-0.5 font-medium',
                            routerEvent.data.overridden
                              ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                              : 'text-violet-400 bg-violet-500/10 border-violet-500/30',
                          )}
                        >
                          {String(routerEvent.data.classifiedAs)}
                          {routerEvent.data.overridden ? ' (forced)' : ''}
                        </span>
                        <span className="text-[10px] text-zinc-600">&rarr;</span>
                        <span className="text-[10px] font-mono text-zinc-300">
                          {String(routerEvent.data.selectedModel)}
                        </span>
                      </div>
                      {routerEvent.data.hints != null && (
                        <div className="text-[10px] text-zinc-500">
                          Hints:{' '}
                          <span className="font-mono text-zinc-400">{JSON.stringify(routerEvent.data.hints)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Cascade tier progression */}
                  {cascadeTiers.length > 0 && (
                    <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3 space-y-2">
                      <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider">Cascade</span>
                      <div className="space-y-1.5">
                        {cascadeTiers.map((tier, i) => {
                          const status = String(tier.data.status)
                          const statusStyle =
                            status === 'accepted'
                              ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                              : status === 'rejected'
                                ? 'text-red-400 bg-red-500/10 border-red-500/30'
                                : 'text-zinc-500 bg-zinc-800 border-zinc-700'
                          return (
                            <div key={i} className="flex items-center gap-2 text-[10px]">
                              <span className="text-zinc-600 tabular-nums w-4">{Number(tier.data.tierIndex) + 1}</span>
                              <span className="font-mono text-zinc-300 min-w-0 truncate">
                                {String(tier.data.model)}
                              </span>
                              <span className={cn('rounded border px-1.5 py-0.5 shrink-0', statusStyle)}>{status}</span>
                              {tier.data.durationMs != null && (
                                <span className="text-zinc-600 tabular-nums shrink-0">
                                  {Number(tier.data.durationMs)}ms
                                </span>
                              )}
                              {tier.data.cost != null && Number(tier.data.cost) > 0 && (
                                <span className="text-emerald-400/60 tabular-nums shrink-0">
                                  {formatCost(Number(tier.data.cost))}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      {cascadeEvent && (
                        <div className="flex gap-3 text-[10px] text-zinc-500 pt-1 border-t border-zinc-800/40">
                          <span>
                            Accepted at tier{' '}
                            <span className="text-zinc-300">{Number(cascadeEvent.data.acceptedTier) + 1}</span>/
                            {String(cascadeEvent.data.totalTiers)}
                          </span>
                          {Number(cascadeEvent.data.totalCost) > 0 && (
                            <span>
                              Total cost{' '}
                              <span className="text-emerald-300">
                                {formatCost(Number(cascadeEvent.data.totalCost))}
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Section>
            )
          })()}

          {/* Input */}
          <Section title="Input" defaultOpen={true} className={hasError ? '' : 'border-t-0'}>
            <JsonBlock data={trace.input} maxHeight="max-h-48" />
          </Section>

          {/* Context Composition — unified view of everything going to the LLM */}
          {trace.inspect && trace.inspect.system.parts.length > 0 && (
            <Section
              title="Context Composition"
              defaultOpen={true}
              badge={
                <span className="text-[10px] tabular-nums text-zinc-600">
                  {trace.inspect.system.parts.filter((p) => !p.skipped).length + (trace.inspect.prompt ? 1 : 0)} part
                  {trace.inspect.system.parts.filter((p) => !p.skipped).length + (trace.inspect.prompt ? 1 : 0) !== 1
                    ? 's'
                    : ''}{' '}
                  · {formatTokens(trace.inspect.totalTokens)} tok
                  {trace.inspect.tools && trace.inspect.tools.length > 0
                    ? ` · ${trace.inspect.tools.length} tool${trace.inspect.tools.length !== 1 ? 's' : ''}`
                    : ''}
                </span>
              }
            >
              <div className="space-y-3 overflow-hidden min-w-0">
                {/* Prompt definition summary */}
                {promptDef && (
                  <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <FileTextIcon className="size-3.5 text-zinc-500 shrink-0" />
                      <button
                        onClick={() =>
                          navigate({
                            view: 'prompts',
                            promptId: trace.promptId!,
                          })
                        }
                        className="text-xs font-medium text-zinc-200 hover:text-cyan-300 transition-colors"
                      >
                        {trace.promptId}
                      </button>
                      {promptDef.description && (
                        <span className="text-[10px] text-zinc-500 truncate">{promptDef.description}</span>
                      )}
                    </div>
                    {/* Context composition map */}
                    {promptDef.contextIds.filter(Boolean).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {promptDef.contextIds.filter(Boolean).map((ctxId) => {
                          const ctx = contextLookup.get(`context:${ctxId}`)
                          return (
                            <button
                              key={ctxId}
                              onClick={() => navigate({ view: 'library-catalog', contextId: ctxId! })}
                              className={cn(
                                'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors',
                                'border-violet-500/30 bg-violet-500/5 text-violet-300 hover:bg-violet-500/15',
                              )}
                            >
                              <PuzzleIcon className="size-2.5" />
                              {ctxId}
                              {ctx && <span className="text-violet-400/60">p{ctx.priority}</span>}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Request Map — visual overview of the full request anatomy */}
                <RequestMap
                  inspect={trace.inspect!}
                  tools={trace.inspect!.tools ?? undefined}
                  contextLookup={contextLookup}
                  onSegmentClick={handleSegmentClick}
                />

                {/* Input parameters passed to contexts */}
                {trace.input && Object.keys(trace.input).length > 0 && (
                  <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-3 overflow-hidden min-w-0">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Input Parameters</div>
                    <div className="space-y-1.5">
                      {Object.entries(trace.input).map(([key, value]) => {
                        const strVal = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
                        return (
                          <div key={key} className="min-w-0">
                            <span className="font-mono text-[11px] text-zinc-500">{key}</span>
                            <div className="mt-0.5 rounded bg-zinc-950/60 border border-zinc-800/40 overflow-hidden min-w-0">
                              <pre className="px-2.5 py-1.5 text-[11px] text-zinc-300 leading-relaxed whitespace-pre-wrap break-words overflow-hidden max-h-32 overflow-y-auto">
                                {strVal}
                              </pre>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Message parts — system parts + user prompt, in order */}
                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">Message Composition</div>
                {trace.inspect.system.parts.map((part) => {
                  const ctxMeta = contextLookup.get(part.source)
                  const isPromptPart = part.source === 'prompt'
                  const isContext = part.source.startsWith('context:') || part.source.startsWith('context[')
                  return (
                    <div
                      key={part.source}
                      ref={(el) => {
                        if (el) cardRefs.current.set(part.source, el)
                      }}
                      className={cn(
                        'transition-all duration-300',
                        highlightedSource === part.source && 'ring-2 ring-cyan-500/40 rounded-lg',
                      )}
                    >
                      <ContextPartCard
                        source={part.source}
                        text={part.text}
                        tokens={part.tokens}
                        skipped={part.skipped}
                        role="system"
                        isPromptPart={isPromptPart}
                        isContext={isContext}
                        ctxMeta={ctxMeta}
                        tokenBudget={trace.inspect!.tokenBudget}
                        onViewContext={
                          ctxMeta
                            ? () =>
                                navigate({
                                  view: 'prompts',
                                  contextId: ctxMeta.id!,
                                })
                            : undefined
                        }
                        highlights={partHighlights.get(part.source)}
                      />
                    </div>
                  )
                })}

                {/* Excluded contexts (when/match conditions) */}
                {trace.inspect.excludedContexts && trace.inspect.excludedContexts.length > 0 && (
                  <div className="rounded-lg border border-zinc-800/40 bg-zinc-900/30 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                      <XCircleIcon className="size-3.5 shrink-0" />
                      <span>Excluded contexts ({trace.inspect.excludedContexts.length})</span>
                    </div>
                    {trace.inspect.excludedContexts.map((ctx) => (
                      <div key={ctx.source} className="ml-5 flex items-center justify-between text-xs">
                        <span className="text-zinc-500 line-through truncate">{ctx.source}</span>
                        <span className="text-zinc-600 text-[10px] shrink-0 ml-3">{ctx.reason}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* User prompt — shown as final part in the composition */}
                {trace.inspect.prompt && trace.inspect.prompt.text && (
                  <div
                    ref={(el) => {
                      if (el) cardRefs.current.set('user prompt', el)
                    }}
                    className={cn(
                      'transition-all duration-300',
                      highlightedSource === 'user prompt' && 'ring-2 ring-cyan-500/40 rounded-lg',
                    )}
                  >
                    <ContextPartCard
                      source="user prompt"
                      text={trace.inspect.prompt.text}
                      tokens={trace.inspect.prompt.tokens}
                      skipped={false}
                      role="user"
                      isPromptPart={true}
                      isContext={false}
                      tokenBudget={trace.inspect.tokenBudget}
                      highlights={partHighlights.get('user prompt')}
                    />
                  </div>
                )}

                {/* Available Tools (moved from Attributes tab) */}
                {trace.inspect.tools && trace.inspect.tools.length > 0 && (
                  <div
                    ref={(el) => {
                      if (el) cardRefs.current.set('tools', el)
                    }}
                    className={cn(
                      'transition-all duration-300',
                      highlightedSource === 'tools' && 'ring-2 ring-cyan-500/40 rounded-lg',
                    )}
                  >
                    <div className="rounded-lg border border-zinc-800/60 overflow-hidden">
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/60">
                        <WrenchIcon className="size-3 text-zinc-500 shrink-0" />
                        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">tools</span>
                        <span className="text-xs font-medium text-zinc-300">
                          {trace.inspect.tools.length} available
                        </span>
                      </div>
                      <div className="px-3 py-2 flex flex-wrap gap-1.5">
                        {trace.inspect.tools.map((tool) => (
                          <button
                            key={tool}
                            onClick={() => navigate({ view: 'library-catalog', toolName: tool })}
                            className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-zinc-950/60 border border-zinc-800/40 text-zinc-400 hover:text-cyan-300 hover:border-cyan-500/30 transition-colors cursor-pointer"
                          >
                            {tool}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Fallback — shown when the call used a fallback() model wrapper */}
          {trace.fallback && (
            <Section
              title="Fallback"
              badge={
                <span className="text-[10px] tabular-nums text-amber-400 bg-amber-900/50 rounded-full px-1.5 py-0.5">
                  {trace.fallback.attempts} attempts
                </span>
              }
              defaultOpen={true}
            >
              <div className="border-l-2 border-amber-500/30 pl-3 space-y-2">
                {trace.fallback.failedModels.length > 0 && (
                  <div className="text-xs text-zinc-400">
                    Failed: <span className="text-red-400">{trace.fallback.failedModels.join(', ')}</span>
                  </div>
                )}
                <div className="space-y-1">
                  {trace.fallback.details.map((attempt: any, i: number) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${attempt.status === 'success' ? 'bg-emerald-950/50' : 'bg-red-950/50'}`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${attempt.status === 'success' ? 'bg-emerald-400' : 'bg-red-400'}`}
                      />
                      <span className="font-mono text-zinc-300">{attempt.model}</span>
                      <span className="text-zinc-500">{attempt.durationMs}ms</span>
                      {attempt.error && (
                        <span className="text-red-400 truncate">{attempt.errorCategory || attempt.error}</span>
                      )}
                      {attempt.cost != null && (
                        <span className="text-zinc-500 ml-auto">${attempt.cost.toFixed(4)}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </Section>
          )}

          {/* Stream — unified section for live chunks + final streaming metrics */}
          {((trace.streamProgress && trace.streamProgress.chunks.length > 0) || trace.streaming) && (
            <Section title="Stream" defaultOpen={true}>
              <div className="border-l-2 border-blue-500/30 pl-3 space-y-3">
                {trace.status === 'running' && trace.streamProgress && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                    <span className="text-xs text-blue-400 font-medium">Streaming...</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {/* TTFT — prefer streamProgress (live), fall back to trace.streaming (final) */}
                  {(trace.streamProgress?.ttftMs ?? trace.streaming?.ttftMs) != null &&
                    (() => {
                      const ttft = trace.streamProgress?.ttftMs ?? trace.streaming!.ttftMs
                      return (
                        <MetricPill
                          label="TTFT"
                          value={`${ttft}ms`}
                          className={
                            ttft < 200
                              ? 'bg-emerald-950 text-emerald-400'
                              : ttft < 500
                                ? 'bg-amber-950 text-amber-400'
                                : 'bg-red-950 text-red-400'
                          }
                        />
                      )
                    })()}
                  {/* Throughput — only available from trace.streaming (final, computed server-side) */}
                  {trace.streaming?.tokensPerSecond != null && (
                    <MetricPill
                      label="Throughput"
                      value={`${trace.streaming.tokensPerSecond.toFixed(1)} tok/s`}
                      className="bg-zinc-900"
                    />
                  )}
                  {trace.streamProgress && (
                    <>
                      <MetricPill
                        label="Chunks"
                        value={String(trace.streamProgress.chunksReceived)}
                        className="bg-zinc-900"
                      />
                      {trace.streamProgress.textLength != null && (
                        <MetricPill
                          label="Chars"
                          value={trace.streamProgress.textLength.toLocaleString()}
                          className="bg-zinc-900"
                        />
                      )}
                      <MetricPill
                        label="Elapsed"
                        value={`${(trace.streamProgress.elapsedMs / 1000).toFixed(1)}s`}
                        className="bg-zinc-900"
                      />
                    </>
                  )}
                  {!trace.streamProgress && trace.streaming?.totalChunks != null && (
                    <MetricPill label="Chunks" value={trace.streaming.totalChunks} className="bg-zinc-900" />
                  )}
                </div>
                {trace.streamProgress && trace.streamProgress.chunks.length > 0 && (
                  <StreamChunksView chunks={trace.streamProgress.chunks} isStreaming={trace.status === 'running'} />
                )}
              </div>
            </Section>
          )}

          {/* Response/Output */}
          {trace.result && (trace.result.text != null || trace.result.object != null) && (
            <Section title="Output" defaultOpen={true}>
              <div className="border-l-2 border-emerald-500/30 pl-3 overflow-hidden min-w-0">
                {trace.result.text != null ? (
                  <CodeBlock code={trace.result.text} language="markdown">
                    <CodeBlockHeader>
                      <CodeBlockTitle>Response</CodeBlockTitle>
                      <CodeBlockActions>
                        <CodeBlockCopyButton />
                      </CodeBlockActions>
                    </CodeBlockHeader>
                  </CodeBlock>
                ) : (
                  <JsonBlock data={trace.result.object} maxHeight="max-h-96" />
                )}
              </div>
            </Section>
          )}

          {/* Tool Calls (inline after output) */}
          {hasToolCalls && (
            <Section
              title="Tool Calls"
              badge={
                <span className="text-[10px] tabular-nums text-zinc-600 bg-zinc-800 rounded-full px-1.5 py-0.5">
                  {trace.result!.toolCalls!.length}
                </span>
              }
            >
              <div className="space-y-2">
                {trace.result!.toolCalls!.map((toolCall, index) => {
                  // Match with correlated tool execution events
                  const exec = toolExecMap.get(toolCall.id ?? '') ?? toolExecMap.get(toolCall.name)
                  const durationColor =
                    exec?.durationMs != null
                      ? exec.durationMs < 100
                        ? 'text-emerald-400'
                        : exec.durationMs < 1000
                          ? 'text-amber-400'
                          : 'text-red-400'
                      : ''

                  // Find matching delegate (convention: delegateId contains tool name, e.g. "delegate-research" ↔ "research")
                  const delegateEntry = [...delegateExecMap.entries()].find(
                    ([id]) => id.includes(toolCall.name) || toolCall.name.includes(id.replace('delegate-', '')),
                  )
                  const delegate = delegateEntry?.[1]

                  return (
                    <Tool key={toolCall.id ?? `${toolCall.name}:${index}`} defaultOpen={index === 0}>
                      <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 p-2.5 rounded-lg border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/50 transition-colors">
                        <div className="flex items-center gap-2">
                          <WrenchIcon className="size-3.5 text-zinc-500" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate({
                                view: 'prompts',
                                toolName: toolCall.name,
                              })
                            }}
                            className="font-medium text-xs font-mono text-zinc-200 hover:text-cyan-300 transition-colors inline-flex items-center gap-1"
                          >
                            {toolCall.name}
                            <ExternalLinkIcon className="size-2.5 text-zinc-600" />
                          </button>
                          {exec?.status === 'error' ? (
                            <Badge className="gap-1 rounded-full text-[10px]" variant="destructive">
                              <AlertTriangleIcon className="size-2.5" />
                              Error
                            </Badge>
                          ) : exec?.status === 'running' ? (
                            <Badge className="gap-1 rounded-full text-[10px]" variant="secondary">
                              <span className="size-2 rounded-full bg-blue-400 animate-pulse" />
                              Running
                            </Badge>
                          ) : exec?.status === 'done' ? (
                            <Badge className="gap-1 rounded-full text-[10px]" variant="secondary">
                              <CheckCircleIcon className="size-2.5 text-green-500" />
                              Done
                            </Badge>
                          ) : (
                            <Badge className="gap-1 rounded-full text-[10px]" variant="outline">
                              <ArrowRightIcon className="size-2.5 text-zinc-500" />
                              Requested
                            </Badge>
                          )}
                          {exec?.durationMs != null && (
                            <span
                              className={cn('text-[10px] tabular-nums font-mono', durationColor)}
                              title={exec.estimated ? 'Estimated from step gap timing' : 'Measured execution time'}
                            >
                              {exec.estimated ? '~' : ''}
                              {formatDuration(exec.durationMs)}
                            </span>
                          )}
                        </div>
                        <ChevronDownIcon className="size-3.5 text-zinc-500 transition-transform group-data-[state=open]:rotate-180" />
                      </CollapsibleTrigger>
                      <ToolContent>
                        <div className="pt-1 space-y-2">
                          <div>
                            <h4 className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
                              Arguments
                            </h4>
                            <JsonBlock data={toolCall.args} maxHeight="max-h-48" />
                          </div>
                          {exec?.error && (
                            <div>
                              <h4 className="text-[10px] font-medium text-red-500 uppercase tracking-wider mb-1">
                                Error
                              </h4>
                              <div className="rounded-md bg-red-950/30 border border-red-900/50 px-2.5 py-1.5 text-xs text-red-300 font-mono">
                                {exec.error}
                              </div>
                            </div>
                          )}
                          {exec?.result != null && (
                            <div>
                              <h4 className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1">
                                Result
                              </h4>
                              <JsonBlock data={exec.result} maxHeight="max-h-48" />
                            </div>
                          )}
                        </div>
                      </ToolContent>
                    </Tool>
                  )
                })}
              </div>
            </Section>
          )}
        </TabsContent>

        {/* ─── Scores Tab ─── */}
        <TabsContent value="scores" className="mt-0">
          {traceJudgeEvents.length === 0 ? (
            <div className="text-sm text-zinc-600 p-8 text-center">No judge scores for this trace</div>
          ) : (
            <div className="p-5 space-y-3">
              {traceJudgeEvents.map((j, i) => (
                <div key={`${j.metricId}-${i}`} className="rounded-lg border border-zinc-800 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-zinc-200">{j.metricId}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full',
                          j.score >= 0.7 ? 'bg-emerald-500' : j.score >= 0.5 ? 'bg-amber-500' : 'bg-red-500',
                        )}
                        style={{ width: `${j.score * 100}%` }}
                      />
                    </div>
                    <span
                      className={cn(
                        'text-xs font-medium tabular-nums',
                        j.score >= 0.7 ? 'text-emerald-400' : j.score >= 0.5 ? 'text-amber-400' : 'text-red-400',
                      )}
                    >
                      {j.score.toFixed(2)}
                    </span>
                  </div>
                  {j.reasoning && <div className="text-[11px] text-zinc-500 leading-relaxed">{j.reasoning}</div>}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ─── Attributes Tab ─── */}
        <TabsContent value="attributes" className="mt-0">
          {/* Token breakdown */}
          {usage && (
            <Section title="Token Breakdown" defaultOpen={true} className="border-t-0">
              <div className="grid grid-cols-3 gap-2">
                {usage.inputTokens != null && (
                  <MetricPill label="Input" value={usage.inputTokens.toLocaleString()} className="bg-zinc-900" />
                )}
                {usage.outputTokens != null && (
                  <MetricPill label="Output" value={usage.outputTokens.toLocaleString()} className="bg-zinc-900" />
                )}
                {usage.totalTokens != null && (
                  <MetricPill label="Total" value={usage.totalTokens.toLocaleString()} className="bg-zinc-900" />
                )}
                {usage.cacheReadTokens != null && (
                  <MetricPill
                    label="Cache Read"
                    value={usage.cacheReadTokens.toLocaleString()}
                    className="bg-zinc-900"
                  />
                )}
                {usage.cacheWriteTokens != null && (
                  <MetricPill
                    label="Cache Write"
                    value={usage.cacheWriteTokens.toLocaleString()}
                    className="bg-zinc-900"
                  />
                )}
                {usage.reasoningTokens != null && (
                  <MetricPill
                    label="Reasoning"
                    value={usage.reasoningTokens.toLocaleString()}
                    className="bg-zinc-900"
                  />
                )}
              </div>
              {usage.cacheReadTokens != null && usage.inputTokens != null && usage.inputTokens > 0 && (
                <div className="mt-2 text-[10px] text-zinc-500">
                  Cache hit rate: {Math.round(((usage.cacheReadTokens ?? 0) / usage.inputTokens) * 100)}%
                </div>
              )}
            </Section>
          )}

          {/* Cost */}
          {cost != null && cost > 0 && (
            <Section title="Cost Breakdown" defaultOpen={true}>
              <div className="space-y-3">
                <CostTreemap
                  inputCost={(inputTokens / totalTokensForCost) * cost}
                  outputCost={(outputTokens / totalTokensForCost) * cost}
                  cacheCost={cacheTokens > 0 ? (cacheTokens / totalTokensForCost) * cost : undefined}
                  totalCost={cost}
                />
              </div>
            </Section>
          )}

          {/* IDs & Metadata */}
          <Section title="IDs & Metadata" defaultOpen={true}>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs min-w-0 overflow-hidden">
              <div className="min-w-0">
                <span className="text-zinc-600">Trace ID</span>
                <div className="font-mono text-zinc-400 truncate">{trace.traceId}</div>
              </div>
              <div>
                <span className="text-zinc-600">Provider</span>
                <div className="font-mono text-zinc-400">{trace.provider}</div>
              </div>
              <div>
                <span className="text-zinc-600">Model</span>
                <div className="font-mono text-zinc-400">{trace.model}</div>
              </div>
              {trace.result?.modelId && (
                <div>
                  <span className="text-zinc-600">Actual Model</span>
                  <div className="font-mono text-zinc-400">{trace.result.modelId}</div>
                </div>
              )}
              {trace.sessionId && (
                <div>
                  <span className="text-zinc-600">Session</span>
                  <div className="font-mono text-zinc-400 truncate">{trace.sessionId}</div>
                </div>
              )}
              {trace.flowId && (
                <div>
                  <span className="text-zinc-600">Flow</span>
                  <div className="font-mono text-zinc-400 truncate">{trace.flowId}</div>
                </div>
              )}
              {trace.parentFlowId && (
                <div>
                  <span className="text-zinc-600">Parent Flow</span>
                  <div className="font-mono text-zinc-400 truncate">{trace.parentFlowId}</div>
                </div>
              )}
              {trace.parentTraceId && (
                <div>
                  <span className="text-zinc-600">Parent Trace</span>
                  <div className="font-mono text-zinc-400 truncate">{trace.parentTraceId}</div>
                </div>
              )}
              {trace.stepId && (
                <div>
                  <span className="text-zinc-600">Step</span>
                  <div className="font-mono text-zinc-400">
                    {trace.stepId}
                    {trace.stepLabel ? ` (${trace.stepLabel})` : ''}
                  </div>
                </div>
              )}
              {trace.result?.responseId && (
                <div>
                  <span className="text-zinc-600">Response ID</span>
                  <div className="font-mono text-zinc-400 truncate">{trace.result.responseId}</div>
                </div>
              )}
              {trace.result?.finishReason && (
                <div>
                  <span className="text-zinc-600">Finish Reason</span>
                  <div className="font-mono text-zinc-400">{trace.result.finishReason}</div>
                </div>
              )}
              <div>
                <span className="text-zinc-600">Started</span>
                <div className="font-mono text-zinc-400">{new Date(trace.startedAt).toLocaleString()}</div>
              </div>
              {trace.source &&
                (() => {
                  const src = resolvedSource ?? trace.source
                  return (
                    <div className="col-span-2 min-w-0">
                      <span className="text-zinc-600">Source</span>
                      <div
                        className={`font-mono truncate ${resolvedSource?.resolved ? 'text-cyan-400/80' : 'text-zinc-400'}`}
                        title={
                          resolvedSource?.resolved
                            ? `Resolved from ${trace.source.file}:${trace.source.line}`
                            : undefined
                        }
                      >
                        {src.file}:{src.line}
                        {src.column ? `:${src.column}` : ''}
                        {src.function ? ` (${src.function})` : ''}
                      </div>
                    </div>
                  )
                })()}
            </div>
          </Section>
        </TabsContent>

        {/* ─── Events Tab ─── */}
        <TabsContent value="events" className="mt-0">
          {correlatedEvents.length === 0 ? (
            <div className="text-sm text-zinc-600 p-8 text-center">No correlated events</div>
          ) : (
            <EventList events={correlatedEvents} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Flow Detail
// ─────────────────────────────────────────────────────────────────

function FlowSpanDetail({
  flowRun,
  node,
  onSelectTrace,
  allTraces,
  flowNameMap,
}: {
  flowRun: RuntimeFlowRun
  node: SpanNode
  onSelectTrace: (traceId: string) => void
  allTraces: Trace[]
  flowNameMap?: Map<string, string>
}) {
  const statusColor =
    flowRun.status === 'completed'
      ? 'bg-emerald-400'
      : flowRun.status === 'failed'
        ? 'bg-red-400'
        : 'bg-blue-400 animate-pulse'

  // Collect traces that belong to this flow
  const flowTraces = useMemo(() => {
    return allTraces.filter((t) => t.flowId === flowRun.flowId)
  }, [allTraces, flowRun.flowId])

  return (
    <div>
      <div className="border-b border-zinc-800 px-5 pb-3 pt-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={cn('w-2 h-2 rounded-full shrink-0', statusColor)} />
          <h2 className="text-sm font-semibold text-zinc-100">{flowRun.name}</h2>
          {flowRun.goal && <span className="text-[10px] text-zinc-500 truncate">{flowRun.goal}</span>}
        </div>
        {flowRun.triggerTraceId && (
          <button
            onClick={() => onSelectTrace(flowRun.triggerTraceId!)}
            className="text-[10px] text-cyan-500 hover:text-cyan-400 mb-1.5"
          >
            Triggered by {flowRun.triggerTraceId.slice(0, 12)} →
          </button>
        )}
        <div className="flex flex-wrap gap-1.5">
          <MetricPill label="Duration" value={formatDuration(flowRun.durationMs)} />
          <MetricPill label="Steps" value={flowRun.steps.length} />
          {flowRun.aggregate?.totalTokens != null && (
            <MetricPill label="Tokens" value={formatTokens(flowRun.aggregate.totalTokens)} />
          )}
          {flowRun.aggregate?.totalCost != null && (
            <MetricPill
              label="Cost"
              value={<span className="text-emerald-300">{formatCost(flowRun.aggregate.totalCost)}</span>}
            />
          )}
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start rounded-none border-b border-zinc-800 bg-transparent px-5">
          <TabsTrigger value="overview" className="text-xs">
            Overview
          </TabsTrigger>
          <TabsTrigger value="timeline" className="text-xs">
            Timeline
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0">
          {/* Steps list — from RuntimeFlowRun data or tree children */}
          <Section title={flowRun.steps.length > 0 ? 'Steps' : 'Children'} defaultOpen={true} className="border-t-0">
            <div className="space-y-1.5">
              {flowRun.steps.length > 0
                ? flowRun.steps.map((step, i) => {
                    const stepStatus =
                      step.status === 'completed'
                        ? 'bg-emerald-400'
                        : step.status === 'failed'
                          ? 'bg-red-400'
                          : step.status === 'started'
                            ? 'bg-blue-400 animate-pulse'
                            : 'bg-zinc-600'

                    return (
                      <button
                        key={step.stepId}
                        onClick={() => onSelectTrace(`step:${flowRun.flowId}:${step.stepId}`)}
                        className="flex items-center gap-2 text-[11px] rounded-lg px-3 py-2 bg-zinc-900/50 border border-zinc-800/50 w-full text-left hover:bg-zinc-800/50 transition-colors"
                      >
                        <span className="text-zinc-600 tabular-nums w-4">{i + 1}</span>
                        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', stepStatus)} />
                        <span className="font-medium text-zinc-200 truncate">{step.label}</span>
                        {step.handoffKind && (
                          <span
                            className={cn(
                              'text-[9px] rounded border px-1 py-0.5',
                              HANDOFF_KIND_STYLES[step.handoffKind] ?? 'text-zinc-400 bg-zinc-800 border-zinc-700',
                            )}
                          >
                            {step.handoffKind}
                          </span>
                        )}
                        {step.actor && <span className="text-[10px] text-zinc-500">{step.actor}</span>}
                        <div className="ml-auto flex items-center gap-2 text-zinc-500 tabular-nums shrink-0">
                          {step.totalTokens != null && <span>{formatTokens(step.totalTokens)}</span>}
                          {step.cost != null && <span>{formatCost(step.cost)}</span>}
                          {step.durationMs != null && <span>{formatDuration(step.durationMs)}</span>}
                        </div>
                      </button>
                    )
                  })
                : /* Fall back to tree children when RuntimeFlowRun has no step data */
                  node.children.map((child, i) => (
                    <button
                      key={child.id}
                      onClick={() => onSelectTrace(child.id)}
                      className="flex items-center gap-2 text-[11px] rounded-lg px-3 py-2 bg-zinc-900/50 border border-zinc-800/50 w-full text-left hover:bg-zinc-800/50 transition-colors"
                    >
                      <span className="text-zinc-600 tabular-nums w-4">{i + 1}</span>
                      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', STATUS_COLORS[child.status])} />
                      <span className="font-medium text-zinc-200 truncate">{child.label}</span>
                      {child.kind === 'step' && child.stepData?.handoffKind && (
                        <span
                          className={cn(
                            'text-[9px] rounded border px-1 py-0.5',
                            HANDOFF_KIND_STYLES[child.stepData.handoffKind] ??
                              'text-zinc-400 bg-zinc-800 border-zinc-700',
                          )}
                        >
                          {child.stepData.handoffKind}
                        </span>
                      )}
                      {child.model && (
                        <span className="text-[9px] text-zinc-500 font-mono shrink-0">{child.model}</span>
                      )}
                      <div className="ml-auto flex items-center gap-2 text-zinc-500 tabular-nums shrink-0">
                        {child.tokens != null && <span>{formatTokens(child.tokens)}</span>}
                        {child.cost != null && <span>{formatCost(child.cost)}</span>}
                        {child.durationMs != null && <span>{formatDuration(child.durationMs)}</span>}
                      </div>
                    </button>
                  ))}
            </div>
          </Section>

          {/* Handoff chain */}
          {flowRun.steps.some((s) => s.handoffKind || s.fromStepId) && (
            <Section title="Handoff Chain" defaultOpen={false}>
              <div className="flex flex-wrap items-center gap-1 text-[11px]">
                {flowRun.steps
                  .filter((s) => s.status !== 'skipped')
                  .map((step, i, arr) => (
                    <span key={step.stepId} className="flex items-center gap-1">
                      <span
                        className={cn(
                          'px-1.5 py-0.5 rounded border text-[10px]',
                          HANDOFF_KIND_STYLES[step.handoffKind ?? 'system'] ??
                            'text-zinc-400 bg-zinc-800 border-zinc-700',
                        )}
                      >
                        {step.actor ?? step.label}
                      </span>
                      {i < arr.length - 1 && <ArrowRightIcon className="size-3 text-zinc-600" />}
                    </span>
                  ))}
              </div>
            </Section>
          )}

          {flowRun.error && (
            <Section title="Error" defaultOpen={true}>
              <div className="rounded-lg border border-red-900/40 bg-red-950/30 p-3 text-sm text-red-300 font-mono overflow-hidden min-w-0 break-words">
                {flowRun.error}
              </div>
            </Section>
          )}
        </TabsContent>

        <TabsContent value="timeline" className="mt-0">
          <div className="h-[500px]">
            <Suspense fallback={<div className="p-4"><SkeletonCard bodyLines={6} height={420} /></div>}>
              <FlowWaterfall
                traces={flowTraces}
                allSessionTraces={allTraces}
                onSelectTrace={onSelectTrace}
                flowNameMap={flowNameMap}
              />
            </Suspense>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Session Detail
// ─────────────────────────────────────────────────────────────────

function SessionSpanDetail({
  node,
  onSelectTrace,
  allTraces,
  flowNameMap,
}: {
  node: SpanNode
  onSelectTrace: (traceId: string) => void
  allTraces: Trace[]
  flowNameMap?: Map<string, string>
}) {
  const traceCount = countKind(node, 'trace')
  const flowCount = countKind(node, 'flow')
  const totalCost = sumField(node, 'cost')
  const totalTokens = sumField(node, 'tokens')

  // Collect all traces for this session
  const sessionTraces = useMemo(() => {
    return collectTraces(node)
  }, [node])

  // Build conversation entries from trace children
  const conversationEntries = useMemo(() => {
    const allChildTraces = collectTraceNodes(node)
    return allChildTraces
      .sort((a, b) => a.startedAt - b.startedAt)
      .map((t) => t.trace!)
      .filter((t) => t != null)
  }, [node])

  const handleSelectFlow = useCallback(
    (flowId: string) => {
      onSelectTrace(`flow:${flowId}`)
    },
    [onSelectTrace],
  )

  return (
    <div>
      <div className="border-b border-zinc-800 px-5 pb-3 pt-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={cn('w-2 h-2 rounded-full shrink-0', STATUS_COLORS[node.status])} />
          <h2 className="text-sm font-semibold text-zinc-100 truncate">Session {node.id.slice(0, 12)}</h2>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <MetricPill label="Duration" value={formatDuration(node.durationMs)} />
          <MetricPill label="Traces" value={traceCount} />
          <MetricPill label="Flows" value={flowCount} />
          {totalTokens > 0 && <MetricPill label="Tokens" value={formatTokens(totalTokens)} />}
          {totalCost > 0 && (
            <MetricPill label="Cost" value={<span className="text-emerald-300">{formatCost(totalCost)}</span>} />
          )}
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full justify-start rounded-none border-b border-zinc-800 bg-transparent px-5">
          <TabsTrigger value="overview" className="text-xs">
            Overview
          </TabsTrigger>
          <TabsTrigger value="conversation" className="text-xs">
            Conversation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0">
          <div className="h-[500px]">
            <Suspense fallback={<div className="p-4"><SkeletonCard bodyLines={6} height={420} /></div>}>
              <SessionCanvas
                traces={allTraces}
                onSelectTrace={onSelectTrace}
                onSelectFlow={handleSelectFlow}
                flowNameMap={flowNameMap}
              />
            </Suspense>
          </div>

          <div className="px-5 py-3 text-xs text-zinc-500">
            This session contains {traceCount} trace
            {traceCount !== 1 ? 's' : ''}
            {flowCount > 0 ? ` across ${flowCount} flow${flowCount !== 1 ? 's' : ''}` : ''}.
          </div>
        </TabsContent>

        <TabsContent value="conversation" className="mt-0">
          <div className="p-4 space-y-3">
            {conversationEntries.length === 0 ? (
              <div className="text-xs text-zinc-500 text-center py-8">No conversation data available</div>
            ) : (
              conversationEntries.map((trace) => (
                <ConversationTurn key={trace.traceId} trace={trace} onSelectTrace={onSelectTrace} />
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Conversation Turn — chat-style display of a single trace
// ─────────────────────────────────────────────────────────────────

function ConversationTurn({ trace, onSelectTrace }: { trace: Trace; onSelectTrace: (id: string) => void }) {
  const { navigate } = useNavigation()
  const inputText = useMemo(() => {
    if (!trace.input) return null
    if (typeof trace.input === 'string') return trace.input
    // Try to extract a text representation from common input shapes
    const inp = trace.input as Record<string, unknown>
    if (typeof inp.prompt === 'string') return inp.prompt
    if (typeof inp.message === 'string') return inp.message
    if (typeof inp.text === 'string') return inp.text
    if (Array.isArray(inp.messages)) {
      const last = (inp.messages as Array<Record<string, unknown>>).at(-1)
      if (last && typeof last.content === 'string') return last.content
    }
    return JSON.stringify(trace.input, null, 2)
  }, [trace.input])

  const outputText = useMemo(() => {
    if (!trace.result) return null
    if (trace.result.text) return trace.result.text
    if (trace.result.object) return JSON.stringify(trace.result.object, null, 2)
    return null
  }, [trace.result])

  const usage = trace.result?.usage
  const cost = trace.result?.cost

  return (
    <div className="space-y-2">
      {/* User input bubble */}
      {inputText && (
        <div className="flex gap-2">
          <div className="shrink-0 w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center">
            <UserIcon className="size-3 text-zinc-400" />
          </div>
          <div className="max-w-[85%] rounded-lg bg-zinc-800 px-3 py-2 text-xs text-zinc-200 whitespace-pre-wrap break-words overflow-hidden min-w-0">
            {inputText}
          </div>
        </div>
      )}

      {/* Tool calls (intermediate steps) */}
      {trace.result?.toolCalls && trace.result.toolCalls.length > 0 && (
        <div className="ml-8 space-y-1">
          {trace.result.toolCalls.map((tc, i) => (
            <div key={tc.id ?? i} className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <WrenchIcon className="size-3 text-blue-400" />
              <button
                onClick={() => navigate({ view: 'library-catalog', toolName: tc.name })}
                className="font-mono text-blue-300 hover:text-cyan-300 transition-colors"
              >
                {tc.name}
              </button>
              <span className="text-zinc-600">
                ({typeof tc.args === 'object' ? Object.keys(tc.args as Record<string, unknown>).length : 0} args)
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Metadata bar */}
      <div className="ml-8 flex items-center gap-2 text-[10px] text-zinc-600">
        <span className="font-mono text-zinc-500">{trace.model}</span>
        {trace.durationMs != null && <span>{formatDuration(trace.durationMs)}</span>}
        {usage?.totalTokens != null && <span>{formatTokens(usage.totalTokens)} tok</span>}
        {cost != null && <span className="text-emerald-400/60">{formatCost(cost)}</span>}
        <button onClick={() => onSelectTrace(trace.traceId)} className="text-cyan-500/60 hover:text-cyan-400">
          details →
        </button>
      </div>

      {/* Assistant output bubble */}
      {outputText && (
        <div className="flex gap-2 justify-end">
          <div className="max-w-[85%] rounded-lg bg-zinc-900 border-l-2 border-emerald-500/40 px-3 py-2 text-xs text-zinc-200 whitespace-pre-wrap break-words overflow-hidden min-w-0">
            {outputText}
          </div>
          <div className="shrink-0 w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <BotIcon className="size-3 text-emerald-400" />
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Step Detail
// ─────────────────────────────────────────────────────────────────

function StepSpanDetail({
  node,
  correlatedEvents,
  judgeEvents,
  onSelectTrace,
  contexts,
  prompts,
}: {
  node: SpanNode
  correlatedEvents: CorrelatedEvent[]
  judgeEvents: JudgeEventData[]
  onSelectTrace: (id: string) => void
  contexts?: ContextMeta[]
  prompts?: PromptMeta[]
}) {
  const step = node.stepData
  const traceChildren = node.children.filter((c) => c.kind === 'trace' && c.trace)
  const [selectedTraceIdx, setSelectedTraceIdx] = useState(0)

  // For collapsed single-child steps, the trace is attached directly to the node
  const collapsedTrace = node.trace ?? null
  // Show primary trace detail — collapsed trace takes priority, then first child trace
  const primaryTrace =
    collapsedTrace ??
    (traceChildren.length > 0 ? (traceChildren[selectedTraceIdx]?.trace ?? traceChildren[0].trace!) : null)

  return (
    <div>
      {/* Step header with metadata */}
      <div className="border-b border-zinc-800 px-5 pb-3 pt-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={cn('w-2 h-2 rounded-full shrink-0', STATUS_COLORS[node.status])} />
          <h2 className="text-sm font-semibold text-zinc-100">{step?.label ?? node.label}</h2>
          {step?.handoffKind && (
            <span
              className={cn(
                'text-[10px] rounded border px-1.5 py-0.5',
                HANDOFF_KIND_STYLES[step.handoffKind] ?? 'text-zinc-400 bg-zinc-800 border-zinc-700',
              )}
            >
              {step.handoffKind}
            </span>
          )}
          {step?.actor && <span className="text-[10px] text-zinc-500">{step.actor}</span>}
          {primaryTrace && (
            <span className="text-[10px] font-mono text-zinc-500">{primaryTrace.model.replace(/^[^/]+\//, '')}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <MetricPill label="Duration" value={formatDuration(step?.durationMs ?? node.durationMs)} />
          {(step?.totalTokens ?? node.tokens) != null && (
            <MetricPill label="Tokens" value={formatTokens(step?.totalTokens ?? node.tokens)} />
          )}
          {(step?.cost ?? node.cost) != null && (
            <MetricPill
              label="Cost"
              value={<span className="text-emerald-300">{formatCost((step?.cost ?? node.cost)!)}</span>}
            />
          )}
        </div>
      </div>

      {/* Step-specific metadata */}
      {step && (step.inputSummary || step.outputSummary || step.note) && (
        <div className="border-b border-zinc-800/50">
          {step.inputSummary && (
            <Section title="Step Input" defaultOpen={false} className="border-t-0">
              <div className="text-xs text-zinc-300">{step.inputSummary}</div>
            </Section>
          )}
          {step.outputSummary && (
            <Section title="Step Output" defaultOpen={false}>
              <div className="text-xs text-zinc-300">{step.outputSummary}</div>
            </Section>
          )}
          {step.note && (
            <Section title="Note" defaultOpen={false}>
              <div className="text-xs text-zinc-400 italic">{step.note}</div>
            </Section>
          )}
        </div>
      )}

      {/* Primary trace content: show full trace detail inline */}
      {primaryTrace ? (
        <>
          {/* Trace selector for multi-trace steps */}
          {traceChildren.length > 1 && (
            <div className="flex items-center gap-1.5 px-5 py-2 border-b border-zinc-800/50 bg-zinc-900/30">
              <span className="text-[10px] text-zinc-500">{traceChildren.length} traces:</span>
              {traceChildren.map((child, i) => (
                <button
                  key={child.id}
                  onClick={() => setSelectedTraceIdx(i)}
                  className={cn(
                    'text-[10px] rounded border px-1.5 py-0.5 transition-colors',
                    i === selectedTraceIdx
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-300',
                  )}
                >
                  {child.label}
                </button>
              ))}
            </div>
          )}
          <TraceSpanDetail
            trace={primaryTrace}
            correlatedEvents={correlatedEvents}
            judgeEvents={judgeEvents}
            contexts={contexts}
            prompts={prompts}
          />
        </>
      ) : step?.toolCallNames && step.toolCallNames.length > 0 ? (
        /* No traces, but tool calls registered */
        <Section title="Tool Calls" defaultOpen={true} className="border-t-0">
          <div className="flex flex-wrap gap-1.5">
            {step.toolCallNames.map((name) => (
              <span
                key={name}
                className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400"
              >
                {name}
              </span>
            ))}
          </div>
        </Section>
      ) : (
        <div className="px-5 py-6 text-[11px] text-zinc-500 text-center">
          {!step ? 'No step data available' : 'No trace data for this step. Select a child in the tree for details.'}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Flow Node Fallback (when no RuntimeFlowRun data)
// ─────────────────────────────────────────────────────────────────

function FlowNodeFallback({ node, onSelectTrace }: { node: SpanNode; onSelectTrace: (id: string) => void }) {
  const traceChildren = node.children.filter((c) => c.kind === 'trace')
  const totalCost = sumField(node, 'cost')
  const totalTokens = sumField(node, 'tokens')

  return (
    <div>
      <div className="border-b border-zinc-800 px-5 pb-3 pt-4">
        <div className="flex items-center gap-2 mb-2">
          <span className={cn('w-2 h-2 rounded-full shrink-0', STATUS_COLORS[node.status])} />
          <h2 className="text-sm font-semibold text-zinc-100">{node.label}</h2>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <MetricPill label="Duration" value={formatDuration(node.durationMs)} />
          <MetricPill label="Traces" value={node.children.length} />
          {totalTokens > 0 && <MetricPill label="Tokens" value={formatTokens(totalTokens)} />}
          {totalCost > 0 && (
            <MetricPill label="Cost" value={<span className="text-emerald-300">{formatCost(totalCost)}</span>} />
          )}
        </div>
      </div>

      <Section title="Traces" defaultOpen={true} className="border-t-0">
        <div className="space-y-1.5">
          {(traceChildren.length > 0 ? traceChildren : node.children).map((child, i) => (
            <button
              key={child.id}
              onClick={() => onSelectTrace(child.id)}
              className="flex items-center gap-2 text-[11px] rounded-lg px-3 py-2 w-full text-left bg-zinc-900/50 border border-zinc-800/50 hover:bg-zinc-800/50 transition-colors"
            >
              <span className="text-zinc-600 tabular-nums w-4">{i + 1}</span>
              <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', STATUS_COLORS[child.status])} />
              <span className="font-medium text-zinc-200 truncate">{child.label}</span>
              {child.model && <span className="text-[9px] text-zinc-500 font-mono shrink-0">{child.model}</span>}
              <div className="ml-auto flex items-center gap-2 text-zinc-500 tabular-nums shrink-0">
                {child.tokens != null && <span>{formatTokens(child.tokens)}</span>}
                {child.cost != null && <span>{formatCost(child.cost)}</span>}
                {child.durationMs != null && <span>{formatDuration(child.durationMs)}</span>}
              </div>
            </button>
          ))}
        </div>
      </Section>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Main SpanDetail
// ─────────────────────────────────────────────────────────────────

interface SpanDetailProps {
  node: SpanNode | null
  correlatedEvents: CorrelatedEvent[]
  judgeEvents: JudgeEventData[]
  onSelectTrace: (traceId: string) => void
  allTraces: Trace[]
  flowNameMap?: Map<string, string>
  contexts?: ContextMeta[]
  prompts?: PromptMeta[]
}

// ---------------------------------------------------------------------------
// Handoff detail — shows delegate/handoff connection data
// ---------------------------------------------------------------------------

function HandoffSpanDetail({ node, correlatedEvents }: { node: SpanNode; correlatedEvents: CorrelatedEvent[] }) {
  const d = node.delegate
  if (!d) return null

  // Find the handoff:prepare event for summary and agent info
  const handoffEvent = correlatedEvents.find(
    (e) => e.eventType === 'handoff:prepare' && e.data.handoffId === d.handoffId,
  )

  return (
    <div className="p-5 space-y-4 text-[11px]">
      <div>
        <h2 className="text-sm font-medium text-orange-400 mb-3">Delegate Handoff</h2>
        <div className="space-y-3">
          {/* Identity */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
            <div className="flex justify-between">
              <span className="text-zinc-500">Delegate</span>
              <span className="text-zinc-200 font-mono">{d.delegateId}</span>
            </div>
            {d.handoffId && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Handoff</span>
                <span className="text-zinc-200 font-mono">{d.handoffId}</span>
              </div>
            )}
            {(d.fromAgent != null || handoffEvent?.data.fromAgent != null) && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Flow</span>
                <span className="text-zinc-200">
                  {String(d.fromAgent ?? handoffEvent?.data.fromAgent ?? '?')} →{' '}
                  {String(d.toAgent ?? handoffEvent?.data.toAgent ?? '?')}
                </span>
              </div>
            )}
          </div>

          {/* Metrics */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
            {d.durationMs != null && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Duration</span>
                <span className="text-zinc-200 tabular-nums">{formatDuration(d.durationMs)}</span>
              </div>
            )}
            {d.inputSize != null && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Input size</span>
                <span className="text-zinc-200 tabular-nums">{d.inputSize.toLocaleString()} bytes</span>
              </div>
            )}
            {d.outputSize != null && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Output size</span>
                <span className="text-zinc-200 tabular-nums">{d.outputSize.toLocaleString()} bytes</span>
              </div>
            )}
            {d.inputSize != null && d.outputSize != null && d.inputSize > 0 && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Compression</span>
                <span className="text-zinc-200 tabular-nums">
                  {Math.round((1 - d.outputSize / d.inputSize) * 100)}%
                </span>
              </div>
            )}
          </div>

          {/* Input data */}
          {d.input != null && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <h4 className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-2">
                Input (delegate args)
              </h4>
              <JsonBlock data={d.input} maxHeight="max-h-64" />
            </div>
          )}

          {/* Output data */}
          {d.output != null && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <h4 className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-2">
                Output (after handoff transform)
              </h4>
              <JsonBlock data={d.output} maxHeight="max-h-64" />
            </div>
          )}

          {/* Summary (from handoff.summarize if configured) */}
          {handoffEvent?.data.summary != null && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
              <h4 className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-2">Handoff Summary</h4>
              <p className="text-zinc-300 whitespace-pre-wrap">{String(handoffEvent.data.summary)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Correlated events */}
      {correlatedEvents.length > 0 && (
        <div>
          <h3 className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-2">Related Events</h3>
          <EventList events={correlatedEvents} />
        </div>
      )}
    </div>
  )
}

export function SpanDetail({
  node,
  correlatedEvents,
  judgeEvents,
  onSelectTrace,
  allTraces,
  flowNameMap,
  contexts,
  prompts,
}: SpanDetailProps) {
  if (!node) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-zinc-600">Select a span to view details</div>
    )
  }

  switch (node.kind) {
    case 'trace':
      return node.trace ? (
        <TraceSpanDetail
          trace={node.trace}
          correlatedEvents={correlatedEvents}
          judgeEvents={judgeEvents}
          contexts={contexts}
          prompts={prompts}
        />
      ) : null

    case 'flow':
      return node.flowRun ? (
        <FlowSpanDetail
          flowRun={node.flowRun}
          node={node}
          onSelectTrace={onSelectTrace}
          allTraces={allTraces}
          flowNameMap={flowNameMap}
        />
      ) : (
        <FlowNodeFallback node={node} onSelectTrace={onSelectTrace} />
      )

    case 'session':
      return (
        <SessionSpanDetail node={node} onSelectTrace={onSelectTrace} allTraces={allTraces} flowNameMap={flowNameMap} />
      )

    case 'step':
      return (
        <StepSpanDetail
          node={node}
          correlatedEvents={correlatedEvents}
          judgeEvents={judgeEvents}
          onSelectTrace={onSelectTrace}
          contexts={contexts}
          prompts={prompts}
        />
      )

    case 'handoff':
      return <HandoffSpanDetail node={node} correlatedEvents={correlatedEvents} />

    default:
      return null
  }
}
