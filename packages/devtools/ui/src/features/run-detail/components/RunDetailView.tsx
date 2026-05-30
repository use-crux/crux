/**
 * Run detail screen.
 *
 * Two complementary modes: Inspect (backend RunDetail + tabbed detail) and
 * Replay (cinematic scrubber + narrative thread). Toggled via the page
 * tab strip.
 */

import { useEffect, useMemo } from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { Btn } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonCard, SkeletonRows } from '@/shared/components/Skeleton'
import { navTarget } from '@/app/navigation/navTarget'
import { useQualityFeedback, useQualityRunDetailSuspense } from '@/shared/hooks/useQualityApi'
import { qk } from '@/shared/query/queryClient'
import { useToast } from '@/qw/shell/useToast'
import { ReplayPlayer } from './ReplayPlayer'
import type { ReplayEventInput, ReplayEventPayload } from '@/features/run-detail/types'
import { useNavigation, type RunDetailMode } from '@/app/navigation/useNavigation'
import { useObservabilityGraph } from '@/features/observability/hooks/useObservabilityGraph'
import { useConnected, useJudgeEvents } from '@/app/runtime/runtimeStore'
import { CanvasMode, InspectMode } from '@/features/run-detail/components/RunDetailModes'
import { RunLevelView, SaveAsCasePrompt } from '@/features/run-detail/components/RunLevelViews'
import type { Trace, QualityRunNarrativeEvent, QualityRunSpan } from '@/types'

interface RunDetailProps {
  traceId: string
  mode: RunDetailMode
  spanId?: string
}

function formatLatency(ms: number | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function RunDetailView({ traceId, mode, spanId: navSpanId }: RunDetailProps) {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const judgeEvents = useJudgeEvents()
  const { toast } = useToast()
  // Suspends on first paint — caught by the App-level Suspense.
  // Subsequent refetches (per the polling cadence built into the hook)
  // keep the previous detail visible.
  const detail = useQualityRunDetailSuspense(traceId)
  const canonicalHeader = useObservabilityGraph(traceId)
  const { data: feedbackList } = useQualityFeedback()
  const allFeedback = feedbackList ?? []

  const run = canonicalHeader.runDetail?.run
  const trace = detail.trace
  const target = detail.run.targetId ?? run?.promptId ?? run?.name ?? run?.rootPrimitive ?? traceId
  const duration = detail.run.durationMs ?? run?.durationMs
  const status = detail.run.status ?? run?.status ?? 'unknown'

  return (
    <QwShell
      activeView="runs"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb={`Inspect / Runs / ${traceId.slice(0, 12)}…`}
      title={`${target} · ${formatLatency(duration)}`}
      subtitle={`run ${traceId.slice(0, 12)}…${trace?.model || run?.model ? ' · ' + (trace?.model ?? run?.model) : ''}`}
      connected={connected}
      noScroll={mode === 'inspect' || mode === 'canvas'}
      actions={
        <>
          <Btn
            icon={<Icon name="layers" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Save as case',
                message: 'Open a Suite and use "Add case" — a one-click capture from this trace is next.',
              })
            }
          >
            Save as case
          </Btn>
          <Btn icon={<Icon name="compare" size={13} />} onClick={() => navigate({ view: 'compare' })}>
            Compare
          </Btn>
          <Btn
            variant="primary"
            icon={<Icon name={mode === 'replay' ? 'trace' : 'play'} size={13} />}
            onClick={() =>
              navigate({
                view: 'run-detail',
                traceId,
                mode: mode === 'inspect' ? 'replay' : 'inspect',
                spanId: navSpanId,
              })
            }
          >
            {mode === 'inspect' ? 'Replay' : 'Inspect'}
          </Btn>
        </>
      }
      tabs={[
        {
          label: 'Inspect',
          active: mode === 'inspect',
          iconName: 'trace',
          onClick: () => navigate({ view: 'run-detail', traceId, mode: 'inspect', spanId: navSpanId }),
        },
        {
          label: 'Replay',
          active: mode === 'replay',
          iconName: 'play',
          onClick: () => navigate({ view: 'run-detail', traceId, mode: 'replay', spanId: navSpanId }),
        },
        {
          label: 'Canvas',
          active: mode === 'canvas',
          iconName: 'flask',
          onClick: () => navigate({ view: 'run-detail', traceId, mode: 'canvas', spanId: navSpanId }),
        },
        {
          label: 'Feedback',
          active: mode === 'feedback',
          count: allFeedback.filter((f) => f.traceId === traceId).length || null,
          onClick: () => navigate({ view: 'run-detail', traceId, mode: 'feedback', spanId: navSpanId }),
        },
        {
          label: 'Scores',
          active: mode === 'scores',
          count: judgeEvents.filter((j) => j.traceId === traceId).length || null,
          onClick: () => navigate({ view: 'run-detail', traceId, mode: 'scores', spanId: navSpanId }),
        },
      ]}
    >
      <SectionBoundary
        title="Run detail"
        fallback={<RunDetailSkeleton mode={mode} />}
        resetKey={`${traceId}:${mode}`}
        invalidateKeys={[qk.quality.run(traceId), qk.observability.run(traceId)]}
      >
        {mode === 'inspect' ? (
          <InspectMode
            traceId={traceId}
            spanId={navSpanId}
            trace={trace}
            judges={judgeEvents.filter((j) => j.traceId === traceId)}
          />
        ) : mode === 'canvas' ? (
          <CanvasMode traceId={traceId} spanId={navSpanId} />
        ) : mode === 'feedback' ? (
          <RunLevelView trace={trace} traceId={traceId} mode="feedback" />
        ) : mode === 'scores' ? (
          <RunLevelView trace={trace} traceId={traceId} mode="scores" />
        ) : (
          <ReplayMode
            trace={trace}
            duration={duration}
            status={status}
            narrative={detail.narrative}
            spans={detail.spans}
          />
        )}
      </SectionBoundary>
    </QwShell>
  )
}

// ─── Loading skeleton ───────────────────────────────────────────────

function RunDetailSkeleton({ mode }: { mode: RunDetailMode }) {
  // Inspect / canvas modes use a 320px sidebar + detail layout. Replay
  // is a single-column timeline. Match the corresponding shapes so the
  // skeleton doesn't shift on swap.
  if (mode === 'replay') {
    return (
      <div className="mx-auto flex flex-col gap-4 px-8 py-6" style={{ maxWidth: 1120 }}>
        <SkeletonCard bodyLines={2} height={70} />
        <SkeletonRows rows={8} rowHeight={48} />
      </div>
    )
  }
  return (
    <div className="grid h-full" style={{ gridTemplateColumns: '320px 1fr' }}>
      <aside
        className="flex h-full flex-col gap-2 p-3"
        style={{ borderRight: '1px solid var(--qw-border)', background: 'var(--qw-bg)' }}
      >
        <SkeletonRows rows={14} rowHeight={28} />
      </aside>
      <div className="flex flex-col gap-4 p-6">
        <SkeletonCard bodyLines={3} />
        <SkeletonCard bodyLines={6} />
        <SkeletonCard bodyLines={4} />
      </div>
    </div>
  )
}

// ─── Canvas mode (whole-run ReactFlow graph) ────────────────────────

// ─── Replay mode ────────────────────────────────────────────────────

type ReplayEvent = ReplayEventInput

function ReplayMode({
  trace,
  duration,
  status,
  narrative,
  spans,
}: {
  trace: Trace | undefined
  duration: number | undefined
  status: string
  narrative?: readonly QualityRunNarrativeEvent[]
  spans?: readonly QualityRunSpan[]
}) {
  const segments = useMemo(() => {
    const out: { id: string; kind: string; name: string; offsetMs: number; durationMs: number }[] = []
    if (!spans || spans.length === 0) return out
    const started = spans.map((span) => span.startedAt).filter((value): value is number => typeof value === 'number')
    const start = started.length > 0 ? Math.min(...started) : (trace?.startedAt ?? Date.now())
    for (const span of spans) {
      if (span.durationMs == null) continue
      out.push({
        id: span.id,
        kind: span.primitive,
        name: span.name,
        offsetMs: Math.max(0, (span.startedAt ?? start) - start),
        durationMs: span.durationMs,
      })
    }
    return out
  }, [spans, trace])

  const timelineTotal = useMemo(() => {
    let max = duration ?? 0
    for (const s of segments) max = Math.max(max, s.offsetMs + s.durationMs)
    return Math.max(1, max)
  }, [duration, segments])

  const replayEvents = useMemo<readonly ReplayEvent[]>(() => {
    return buildReplay({ trace, narrative, spans })
  }, [trace, narrative, spans])

  const topMeta = useMemo(() => {
    const items: { label: string; value: string }[] = []
    if (trace?.model) items.push({ label: 'model', value: trace.model })
    const usage = trace?.result?.usage
    if (usage?.totalTokens) items.push({ label: 'tokens', value: usage.totalTokens.toLocaleString() })
    if (trace?.result?.cost != null) items.push({ label: 'cost', value: `$${trace.result.cost.toFixed(4)}` })
    return items
  }, [trace])

  return (
    <>
      <ReplayPlayer
        events={replayEvents}
        durationMs={timelineTotal}
        segments={segments}
        status={status}
        topMeta={topMeta}
      />
      <div className="mx-auto px-8 pb-12" style={{ maxWidth: 1120 }}>
        <SaveAsCasePrompt />
      </div>
    </>
  )
}

// ─── Replay narrative builder ───────────────────────────────────────

function truncate(s: string, n = 800): string {
  if (s.length <= n) return s
  return s.slice(0, n) + '…'
}

function pickPreview(text: string | undefined, max = 320): string {
  if (!text) return ''
  return truncate(text.replace(/\s+/g, ' ').trim(), max)
}

function tokensSummary(usage: unknown): string {
  if (!usage || typeof usage !== 'object') return ''
  const u = usage as Record<string, unknown>
  const inT = typeof u.inputTokens === 'number' ? u.inputTokens : undefined
  const outT = typeof u.outputTokens === 'number' ? u.outputTokens : undefined
  const total = typeof u.totalTokens === 'number' ? u.totalTokens : undefined
  if (inT != null || outT != null) {
    return `${inT ?? 0} in / ${outT ?? 0} out`
  }
  if (total != null) return `${total} tok`
  return ''
}

/**
 * Read a span field that may live on the merged `data` payload or be
 * a primitive-specific top-level key. Returns `undefined` if absent.
 */
function spanField(s: QualityRunSpan, ...keys: readonly string[]): unknown {
  const data = s.data
  if (data) {
    for (const k of keys) {
      const v = data[k]
      if (v !== undefined && v !== null) return v
    }
  }
  return undefined
}

/**
 * Map a `QualityRunSpan` into a replay event when it represents an
 * action worth showing (tool call, generation, retrieval, judge,
 * handoff, delegate). Spans without rich `data` return null and are
 * skipped — we don't want to spam the replay with empty rows.
 */
function spanToReplay(s: QualityRunSpan, startMs: number): ReplayEvent | null {
  if (s.startedAt == null) return null
  const offset = Math.max(0, s.startedAt - startMs)
  const t = `+${offset}ms`
  const dur = s.durationMs != null ? `${Math.round(s.durationMs)}ms` : ''
  const cost = s.cost != null ? `$${s.cost.toFixed(4)}` : ''
  const toks = s.tokenCount != null ? `${s.tokenCount.toLocaleString()} tok` : ''
  const baseMeta = [dur, toks, cost].filter(Boolean).join(' · ') || undefined

  switch (s.primitive) {
    case 'tool': {
      const name = (spanField(s, 'toolName', 'name') as string) ?? s.name
      const args = spanField(s, 'args', 'input')
      const result = spanField(s, 'result', 'output')
      return {
        who: name,
        kind: 'tool',
        what: result !== undefined ? `${name} returned` : `${name} called`,
        body: result ?? args,
        meta: baseMeta,
        t,
        tMs: offset,
      }
    }
    case 'generation':
    case 'trace': {
      const text =
        (spanField(s, 'text') as string | undefined) ??
        (() => {
          const o = spanField(s, 'output')
          if (typeof o === 'string') return o
          if (o != null) return JSON.stringify(o)
          return undefined
        })()
      const model = spanField(s, 'model') as string | undefined
      const ttftMs = s.timings?.ttftMs
      const tps = s.timings?.tokensPerSecond
      const streamingMeta = [ttftMs != null ? `TTFT ${ttftMs}ms` : '', tps != null ? `${tps.toFixed(1)} t/s` : '']
        .filter(Boolean)
        .join(' · ')
      const meta = [model, baseMeta, streamingMeta].filter(Boolean).join(' · ') || undefined
      if (!text) return null
      return {
        who: model ?? s.name,
        kind: 'generate',
        what: pickPreview(text, 2000),
        meta,
        t,
        tMs: offset,
      }
    }
    case 'retrieval':
    case 'retrieval.stage': {
      const query = spanField(s, 'query') as string | undefined
      const hits = spanField(s, 'hits')
      const k = spanField(s, 'k') as number | undefined
      if (!query && hits == null) return null
      return {
        who: s.name,
        kind: 'tool',
        what: query ? `Retrieve · ${pickPreview(query, 160)}` : 'Retrieval',
        body: hits,
        meta: [baseMeta, k != null ? `k=${k}` : ''].filter(Boolean).join(' · ') || undefined,
        t,
        tMs: offset,
      }
    }
    case 'judge': {
      const score = spanField(s, 'score') as number | undefined
      const rationale = spanField(s, 'rationale') as string | undefined
      return {
        who: (spanField(s, 'judgeName') as string) ?? s.name,
        kind: 'agent',
        what: score != null ? `Judge · ${score.toFixed(2)}` : 'Judge',
        detail: rationale ? pickPreview(rationale, 800) : undefined,
        meta: baseMeta,
        t,
        tMs: offset,
      }
    }
    case 'handoff': {
      const from = spanField(s, 'fromAgent') as string | undefined
      const to = spanField(s, 'toAgent') as string | undefined
      return {
        who: s.name,
        kind: 'handoff',
        what: from && to ? `${from} → ${to}` : s.name,
        body: spanField(s, 'payload'),
        meta: baseMeta,
        t,
        tMs: offset,
      }
    }
    case 'delegate': {
      const to = spanField(s, 'to', 'agent') as string | undefined
      return {
        who: s.name,
        kind: 'handoff',
        what: to ? `Delegate → ${to}` : 'Delegate',
        body: spanField(s, 'returnValue', 'payload'),
        meta: baseMeta,
        t,
        tMs: offset,
      }
    }
    case 'flow':
    case 'flow.step': {
      const label = (spanField(s, 'stepLabel') as string) ?? s.name
      return {
        who: label,
        kind: s.primitive === 'flow' ? 'flow' : 'agent',
        what: s.primitive === 'flow' ? `${label} flow` : `Step · ${label}`,
        meta: baseMeta,
        t,
        tMs: offset,
      }
    }
    default:
      return null
  }
}

/**
 * Decide whether a narrative item is "noise" — folded context resolves,
 * presentation-marked detail spans, no-op memory reads, the root
 * agent.run that already shows in the header. The Replay narrative
 * hides these by default; users opt in to see them via a toggle.
 *
 * Heuristics (in order):
 *  - `kind === 'detail'`: by definition a sub-thing that explains
 *    another span (e.g. context resolution, prompt resolve). Always noise.
 *  - Convex boundary `operation` spans the backend marked as detail
 *    presentation (`data.attributes.presentation.display === 'detail'`).
 *  - Memory reads that returned zero results AND had no query (pure
 *    no-ops — `state.get` polling).
 *  - The agent.run root span — duplicate of the header chip.
 */
function classifyNarrativeNoise(n: QualityRunNarrativeEvent): boolean {
  const kind = n.kind || ''
  if (kind === 'detail') return true
  const data = (n.data ?? {}) as Record<string, unknown>
  const attributes = (data.attributes as Record<string, unknown> | undefined) ?? undefined
  const primitive = typeof data.primitive === 'string' ? (data.primitive as string) : undefined
  // Convex boundary / internal operation spans flagged detail-presentation
  // by the backend.
  if (kind === 'operation') {
    const pres = attributes && (attributes.presentation as { display?: string } | undefined)
    if (pres?.display === 'detail') return true
  }
  // No-op memory polls — empty `state.get` returning nothing
  if (kind === 'event' && typeof data === 'object' && data) {
    const label = n.label || ''
    if (
      label === 'memory.read' &&
      (data as { resultCount?: number; query?: string }).resultCount === 0 &&
      !(data as { query?: string }).query
    ) {
      return true
    }
  }
  // Root agent.run — same info as the page header
  if (primitive === 'agent.run' || (kind === 'agent' && !attributes)) return true
  return false
}

// ─── Per-kind narrative extraction ─────────────────────────────────

function pickStr(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v
  }
  return undefined
}

function pickNum(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return undefined
}

function joinMeta(parts: ReadonlyArray<string | undefined | null | false>): string | undefined {
  const filtered = parts.filter((p): p is string => typeof p === 'string' && p.length > 0)
  return filtered.length > 0 ? filtered.join(' · ') : undefined
}

function formatMs(ms: number | undefined): string | undefined {
  if (ms == null) return undefined
  if (ms < 1) return `<1ms`
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function previewObj(v: unknown, n = 80): string {
  if (v == null) return ''
  if (typeof v === 'string') return pickPreview(v, n)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    const s = JSON.stringify(v)
    return s.length > n ? s.slice(0, n) + '…' : s
  } catch {
    return ''
  }
}

/**
 * Format a tool's args as a python-ish call signature:
 *   `{ a: 1, b: "x" }` → `(a=1, b="x")`
 * Falls back to a JSON preview if not a plain object.
 */
function formatToolArgs(args: unknown, max = 90): string {
  if (args == null) return ''
  if (typeof args === 'string') {
    const trimmed = args.trim()
    return trimmed.length > max ? `(${trimmed.slice(0, max)}…)` : `(${trimmed})`
  }
  if (typeof args === 'object' && !Array.isArray(args)) {
    const obj = args as Record<string, unknown>
    const entries = Object.entries(obj).slice(0, 4)
    const formatted = entries
      .map(([k, v]) => {
        const valStr = typeof v === 'string' ? `"${v.length > 24 ? v.slice(0, 24) + '…' : v}"` : previewObj(v, 24)
        return `${k}=${valStr}`
      })
      .join(', ')
    const rest = Object.keys(obj).length - entries.length
    const tail = rest > 0 ? `, +${rest}` : ''
    const inner = formatted.length > max ? formatted.slice(0, max) + '…' : formatted
    return `(${inner}${tail})`
  }
  return `(${previewObj(args, max)})`
}

/**
 * Format a tool's result as a short → preview:
 *   `{ plan: "annual", seats: 4 }` → `→ plan="annual", seats=4`
 */
function formatToolResult(result: unknown, max = 90): string | undefined {
  if (result == null) return undefined
  if (typeof result === 'string') {
    const trimmed = result.trim()
    if (!trimmed) return undefined
    return `→ ${trimmed.length > max ? trimmed.slice(0, max) + '…' : trimmed}`
  }
  if (typeof result === 'object' && !Array.isArray(result)) {
    const obj = result as Record<string, unknown>
    const entries = Object.entries(obj).slice(0, 3)
    if (entries.length === 0) return '→ {}'
    const formatted = entries
      .map(([k, v]) => {
        const valStr = typeof v === 'string' ? `"${v.length > 20 ? v.slice(0, 20) + '…' : v}"` : previewObj(v, 20)
        return `${k}: ${valStr}`
      })
      .join(' · ')
    const rest = Object.keys(obj).length - entries.length
    const tail = rest > 0 ? ` +${rest}` : ''
    return `→ ${formatted}${tail}`
  }
  return `→ ${previewObj(result, max)}`
}

function tokensInOut(usage: unknown): string | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const u = usage as Record<string, unknown>
  const inT = pickNum(u.inputTokens, u.input_tokens, u.promptTokens, u.prompt_tokens)
  const outT = pickNum(u.outputTokens, u.output_tokens, u.completionTokens, u.completion_tokens)
  const total = pickNum(u.totalTokens, u.total_tokens)
  if (inT != null || outT != null) {
    const totalStr = total != null ? ` (${total.toLocaleString()} tok)` : ''
    return `${(inT ?? 0).toLocaleString()} in / ${(outT ?? 0).toLocaleString()} out${totalStr}`
  }
  if (total != null) return `${total.toLocaleString()} tok`
  return undefined
}

/**
 * Map a single narrative event into a rich replay row. Builds a
 * one-line headline per kind (design pattern: encode the key facts in
 * the headline itself, e.g. `kb.search · "refund 14-day" · 3 hits`),
 * pulls duration/cost/etc. into the right-aligned `meta`, and surfaces
 * cost/token notes as a ⚠-prefixed inline note when relevant.
 */
function narrativeToReplay(n: QualityRunNarrativeEvent): ReplayEvent {
  const offset = typeof n.offsetMs === 'number' ? n.offsetMs : 0
  const data = (n.data ?? {}) as Record<string, unknown>
  const attributes = (data.attributes as Record<string, unknown> | undefined) ?? undefined
  const primitive = pickStr(data.primitive, attributes?.primitive)
  const rawKind = n.kind || 'event'
  const label = n.label || ''
  const kind = canonicalKind(rawKind, label, primitive)
  const durationMs = pickNum(data.durationMs, attributes?.durationMs)
  const durStr = formatMs(durationMs)

  const ext = extractByKind({ kind, n, data, attributes, primitive, label })

  const meta = joinMeta([ext.meta, durStr])

  return {
    who: ext.who,
    kind,
    what: ext.what,
    detail: ext.detail,
    meta,
    body: ext.body,
    payload: ext.payload,
    notes: ext.notes,
    notesTone: ext.notesTone,
    t: `+${offset}ms`,
    tMs: offset,
    noise: classifyNarrativeNoise(n),
  }
}

/**
 * Canonicalize the narrative's kind into the small palette ReplayPlayer
 * actually colors. The backend's `n.kind` can be any of `agent · generate ·
 * tool · memory · retrieval · step · transition · handoff · judge · event ·
 * operation · detail · composition · source · error`, so we normalize
 * to a stable subset for color + headline templating.
 */
function canonicalKind(rawKind: string, label: string, primitive: string | undefined): string {
  if (primitive === 'tool.call' || primitive === 'tool' || rawKind === 'tool') return 'tool'
  if (primitive === 'memory' || rawKind === 'memory' || label.startsWith('memory.')) return 'memory'
  if (primitive === 'retrieval' || primitive === 'retrieval.stage' || rawKind === 'retrieval' || rawKind === 'retrieve')
    return 'retrieval'
  if (
    primitive === 'generation' ||
    primitive === 'trace.generation' ||
    rawKind === 'generate' ||
    rawKind === 'generation' ||
    label.startsWith('generation.')
  )
    return 'generate'
  if (primitive === 'handoff' || rawKind === 'handoff') return 'handoff'
  if (primitive === 'delegate' || rawKind === 'delegate') return 'handoff'
  if (rawKind === 'transition') return 'transition'
  if (rawKind === 'step' || primitive === 'flow.step') return 'step'
  if (rawKind === 'flow' || primitive === 'flow') return 'flow'
  if (rawKind === 'judge' || rawKind === 'score' || label.startsWith('judge.')) return 'score'
  if (rawKind === 'composition') return 'composition'
  if (rawKind === 'source') return 'source'
  if (rawKind === 'error') return 'error'
  if (rawKind === 'agent') return 'agent'
  return rawKind || 'event'
}

interface Extracted {
  who: string
  what: string
  detail?: string
  meta?: string
  body?: unknown
  payload?: ReplayEventPayload
  notes?: string
  notesTone?: 'warn' | 'danger' | 'ok' | 'muted'
}

function extractByKind({
  kind,
  n,
  data,
  attributes,
  primitive,
  label,
}: {
  kind: string
  n: QualityRunNarrativeEvent
  data: Record<string, unknown>
  attributes: Record<string, unknown> | undefined
  primitive: string | undefined
  label: string
}): Extracted {
  const actor = pickStr(data.actor)

  switch (kind) {
    case 'tool': {
      const toolName = pickStr(data.toolName, data.name, attributes?.toolName, attributes?.name) ?? 'tool'
      const args = data.args ?? data.input ?? attributes?.args
      const result = data.result ?? data.output ?? attributes?.result
      const status = pickStr(data.status, attributes?.status)
      const isFailed = status === 'error' || status === 'failed' || data.error != null
      const errorMessage = isFailed
        ? pickStr((data.error as { message?: string } | undefined)?.message, data.errorMessage)
        : undefined
      // Design pattern: `lookup_account(workspace=2a8c) → plan: annual · seats: 4`
      const argsStr = formatToolArgs(args)
      const resultStr = !isFailed ? formatToolResult(result) : undefined
      const headline = `${toolName}${argsStr}${resultStr ? ` ${resultStr}` : ''}`
      const payload: ReplayEventPayload | undefined =
        args != null || result != null || isFailed
          ? { type: 'tool', args, result: isFailed ? undefined : result, status, error: errorMessage }
          : undefined
      return {
        who: toolName,
        what: headline,
        detail: errorMessage,
        payload,
        notes: isFailed ? `tool failed${errorMessage ? ` · ${errorMessage}` : ''}` : undefined,
        notesTone: isFailed ? 'danger' : undefined,
      }
    }
    case 'memory': {
      const operation =
        pickStr(data.operation, attributes?.operation) ??
        (label.startsWith('memory.') ? label.slice('memory.'.length) : undefined)
      const blockKind = pickStr(data.blockKind, attributes?.blockKind, data.kind as string)
      const memoryId = pickStr(data.memoryId, attributes?.memoryId, data.key, attributes?.key)
      const query = pickStr(data.query)
      const resultCount = pickNum(data.resultCount, attributes?.resultCount)
      const value = data.value ?? data.body ?? data.payload
      const parts: string[] = []
      if (blockKind) parts.push(blockKind)
      if (operation) parts.push(operation)
      if (memoryId) parts.push(`#${memoryId}`)
      const head = parts.length > 0 ? parts.join(' · ') : label || 'memory'
      const notes =
        resultCount != null
          ? resultCount === 0
            ? '0 hits'
            : `${resultCount} hit${resultCount === 1 ? '' : 's'}`
          : undefined
      const payload: ReplayEventPayload | undefined =
        value != null || query || memoryId
          ? {
              type: 'memory',
              key: memoryId,
              value,
              query,
              resultCount,
              operation,
            }
          : undefined
      return {
        who: blockKind || actor || 'memory',
        what: head,
        payload,
        notes,
        notesTone: resultCount === 0 ? 'muted' : undefined,
      }
    }
    case 'retrieval': {
      const query = pickStr(data.query, attributes?.query)
      const hits = (data.hits ?? data.results ?? attributes?.hits) as unknown
      const k = pickNum(data.k, attributes?.k, data.topK, attributes?.topK)
      const resultCount =
        pickNum(data.resultCount, attributes?.resultCount) ?? (Array.isArray(hits) ? hits.length : undefined)
      const source = pickStr(data.retrieverName, data.name, attributes?.retrieverName)
      // Design pattern: `kb.search · "refund 14-day" · 3 chunks returned`
      const headline = [
        source || actor || 'retrieve',
        query ? `"${pickPreview(query, 80)}"` : null,
        resultCount != null ? `${resultCount} chunk${resultCount === 1 ? '' : 's'} returned` : null,
      ]
        .filter(Boolean)
        .join(' · ')
      return {
        who: source || actor || 'retrieve',
        what: headline,
        meta: k != null ? `k=${k}` : undefined,
        payload: { type: 'retrieval', query, hits, k },
        notes: resultCount === 0 ? 'no hits' : undefined,
        notesTone: resultCount === 0 ? 'warn' : undefined,
      }
    }
    case 'generate': {
      const model = pickStr(data.model, attributes?.model)
      const text =
        pickStr(data.text, data.output) ??
        (data.output != null && typeof data.output !== 'string' ? JSON.stringify(data.output) : undefined)
      const usage = data.usage ?? attributes?.usage
      const cost = pickNum(data.cost, attributes?.cost)
      const ttftMs = pickNum(data.ttftMs, attributes?.ttftMs)
      const tps = pickNum(data.tokensPerSecond, attributes?.tokensPerSecond)
      const finishReason = pickStr(data.finishReason, attributes?.finishReason)
      const tokStr = tokensInOut(usage)
      const costStr = cost != null ? `$${cost.toFixed(4)}` : undefined
      const headline = text ? pickPreview(text, 2000) : label || 'Generate'
      // Pack model on meta-left, perf on meta-right
      const meta = joinMeta([
        ttftMs != null ? `TTFT ${Math.round(ttftMs)}ms` : undefined,
        tps != null ? `${tps.toFixed(1)} t/s` : undefined,
        finishReason && finishReason !== 'stop' ? finishReason : undefined,
      ])
      // Notes: token + cost summary (warn tone in the design)
      const notes = joinMeta([tokStr, costStr])
      return {
        who: model || actor || 'model',
        what: headline,
        meta,
        notes,
        notesTone: notes ? 'warn' : undefined,
      }
    }
    case 'score': {
      const scorer = pickStr(data.scorerName, data.judgeName, data.metricId, data.name) ?? actor ?? 'judge'
      const score = pickNum(data.score, attributes?.score)
      const rationale = pickStr(data.rationale, data.reasoning, attributes?.rationale)
      const threshold = pickNum(data.threshold, attributes?.threshold)
      const passed = score != null && threshold != null ? score >= threshold : undefined
      const headline = score != null ? `${scorer} → ${score.toFixed(2)}` : scorer
      // Pull a flat record of {scorerName: score} if the event packs a
      // multi-metric breakdown (common shape: `data.scores`).
      const rawBreakdown = data.scores ?? data.breakdown
      const breakdown: Record<string, number> | undefined =
        rawBreakdown && typeof rawBreakdown === 'object' && !Array.isArray(rawBreakdown)
          ? Object.fromEntries(
              Object.entries(rawBreakdown as Record<string, unknown>).filter(
                (entry): entry is [string, number] => typeof entry[1] === 'number',
              ),
            )
          : undefined
      return {
        who: scorer,
        what: headline,
        payload: {
          type: 'score',
          score,
          threshold,
          rationale,
          breakdown: breakdown && Object.keys(breakdown).length > 0 ? breakdown : undefined,
        },
        notesTone: passed === true ? 'ok' : passed === false ? 'danger' : undefined,
      }
    }
    case 'handoff':
    case 'transition': {
      const from = pickStr(data.from, data.fromAgent, attributes?.from)
      const to = pickStr(data.to, data.toAgent, attributes?.to)
      const reason = pickStr(data.reason, attributes?.reason)
      const confidence = pickNum(data.confidence, attributes?.confidence)
      const head = from && to ? `${from} → ${to}` : label || (to ? `→ ${to}` : 'Handoff')
      const tail = joinMeta([confidence != null ? `confidence ${confidence.toFixed(2)}` : undefined])
      const handoffPayload = data.payload ?? data.value
      return {
        who: to || from || actor || 'handoff',
        what: tail ? `${head} · ${tail}` : head,
        payload: {
          type: 'handoff',
          from,
          to,
          reason,
          payload: handoffPayload,
        },
      }
    }
    case 'step': {
      const stepLabel = pickStr(data.stepLabel, data.name, attributes?.stepLabel) ?? label
      const message = pickStr(data.message, data.summary)
      return {
        who: actor || stepLabel || 'step',
        what: message ? `${stepLabel} · ${pickPreview(message, 200)}` : stepLabel,
        body: data.body ?? data.payload,
      }
    }
    case 'flow': {
      const flowName = pickStr(data.name, attributes?.name, data.flowName) ?? label
      const phase = pickStr(data.phase, attributes?.phase)
      const headline = phase ? `${flowName} · ${phase}` : flowName
      return {
        who: flowName,
        what: headline,
        body: data.payload,
      }
    }
    case 'composition': {
      const compName = pickStr(data.name, attributes?.name, data.kind as string) ?? label
      const role = pickStr(data.role, attributes?.role)
      return {
        who: actor || compName,
        what: role ? `${compName} · ${role}` : compName,
        body: data.payload,
      }
    }
    case 'source': {
      const source = pickStr(data.sourceId, data.name, data.path, attributes?.sourceId) ?? label
      const score = pickNum(data.score, attributes?.score)
      const status = pickStr(data.status, attributes?.status)
      return {
        who: 'source',
        what: source,
        meta: joinMeta([score != null ? score.toFixed(2) : undefined, status]),
      }
    }
    case 'error': {
      const message =
        pickStr((data.error as { message?: string } | undefined)?.message, data.message, data.errorMessage) ?? label
      const category = pickStr((data.error as { category?: string } | undefined)?.category, data.category)
      const stack = pickStr((data.error as { stack?: string } | undefined)?.stack, data.stack)
      return {
        who: actor || 'error',
        what: category ? `${category}: ${message}` : message,
        payload: {
          type: 'error',
          message,
          category,
          stack,
        },
        notesTone: 'danger',
      }
    }
    case 'agent':
    default: {
      const message = pickStr(data.message, data.summary)
      const confidence = pickNum(data.confidence, attributes?.confidence)
      const intent = pickStr(data.intent, attributes?.intent)
      const head = label || message || actor || kind
      // Design pattern: `Routed to billing — intent=refund (confidence 0.94)`
      const tail = joinMeta([
        intent ? `intent=${intent}` : undefined,
        confidence != null ? `confidence ${confidence.toFixed(2)}` : undefined,
      ])
      return {
        who: actor || kind,
        what: message ? message : tail ? `${head} · ${tail}` : head,
        detail: typeof data.detail === 'string' ? data.detail : undefined,
        meta: tail && message ? tail : undefined,
        body: data.body ?? data.payload,
      }
    }
  }
}

// ─── Replay event assembler ────────────────────────────────────────

/**
 * Build the chronological replay event list from the available sources,
 * in priority order:
 *  1. `narrative` (the backend's first-class projection — preferred)
 *  2. `spans` (per-span fallback when no narrative is present)
 *  3. `trace` (legacy single-input/single-output traces)
 */
function buildReplay({
  trace,
  narrative,
  spans,
}: {
  trace: Trace | undefined
  narrative?: readonly QualityRunNarrativeEvent[]
  spans?: readonly QualityRunSpan[]
}): readonly ReplayEvent[] {
  if (narrative && narrative.length > 0) {
    return narrative.map((n) => narrativeToReplay(n))
  }

  if (spans && spans.length > 0) {
    const startMs = spans.reduce<number>(
      (min, s) => (s.startedAt != null && s.startedAt < min ? s.startedAt : min),
      Number.POSITIVE_INFINITY,
    )
    const zero = Number.isFinite(startMs) ? startMs : (trace?.startedAt ?? Date.now())
    const out: ReplayEvent[] = []
    for (const s of spans) {
      const ev = spanToReplay(s, zero)
      if (ev) out.push(ev)
    }
    if (out.length > 0) return out.sort((a, b) => a.tMs - b.tMs)
  }

  const out: ReplayEvent[] = []
  if (!trace) return out

  const hasInputObject = typeof trace.input === 'object' && trace.input != null && Object.keys(trace.input).length > 0

  // Top-level input (skip if empty — child traces have their own inputs)
  const inputText = hasInputObject
    ? pickPreview(JSON.stringify(trace.input))
    : typeof trace.input === 'string'
      ? pickPreview(trace.input)
      : ''
  if (inputText) {
    out.push({
      who: 'user',
      kind: 'input',
      what: inputText,
      meta: trace.promptId ? `prompt · ${trace.promptId}` : undefined,
      t: '+0ms',
      tMs: 0,
    })
  }

  if (trace.result?.text || trace.result?.object) {
    const text = trace.result?.text ?? (trace.result?.object ? JSON.stringify(trace.result.object, null, 2) : '')
    const dur = trace.durationMs ?? 0
    out.push({
      who: trace.promptId ?? 'output',
      kind: 'generate',
      what: pickPreview(text, 2000),
      meta: [
        trace.model,
        tokensSummary(trace.result?.usage),
        trace.result?.cost != null ? `$${trace.result.cost.toFixed(4)}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      t: `+${dur}ms`,
      tMs: dur,
    })
  } else if (trace.error) {
    out.push({
      who: trace.promptId ?? 'output',
      kind: 'generate',
      what: `Error: ${trace.error.message}`,
      detail: trace.error.category ?? trace.error.stack,
      t: `+${trace.durationMs ?? 0}ms`,
      tMs: trace.durationMs ?? 0,
    })
  }

  out.sort((a, b) => a.tMs - b.tMs)
  return out
}
