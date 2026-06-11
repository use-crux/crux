/**
 * Run detail screen.
 *
 * One run, four lenses (Tree · Timeline · Graph · Story) over a single shared
 * selection. Nested in the shared app-shell chrome (`QwShell`: breadcrumb ·
 * title · subtitle · actions) per the design's `RunDetailIntegrated` — the
 * standalone run header collapses into the shell header plus a slim
 * `RunContextStrip` (status + headline metrics + diagnostics). The lens switch
 * lives at the top of each lens body, not the header. The selected span flows
 * into the center Detail pane + the constant Inspector rail.
 */

import { useMemo } from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { Btn } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { useToast } from '@/qw/shell/useToast'
import { SkeletonCard, SkeletonRows } from '@/shared/components/Skeleton'
import { useQualityRunDetailSuspense } from '@/shared/hooks/useQualityApi'
import { qk } from '@/shared/query/queryClient'
import { ReplayPlayer } from './ReplayPlayer'
import { RunContextStrip } from './RunContextStrip'
import { FlowSuspendedBanner } from './FlowSuspendedBanner'
import { LensSwitch } from './atoms'
import type { ReplayEventInput, ReplayEventPayload, RunLens } from '@/features/run-detail/types'
import { useNavigation } from '@/app/navigation/useNavigation'
import { navTarget } from '@/app/navigation/navTarget'
import { useObservabilityGraph } from '@/features/observability/hooks/useObservabilityGraph'
import { useJudgeEvents } from '@/app/runtime/runtimeStore'
import { CanvasMode, InspectMode, SummaryMode, type SummaryNav } from '@/features/run-detail/components/RunDetailModes'
import { archetypeHasSummary, archetypeStrip, runArchetype } from '@/features/run-detail/lib/archetype'
import type { Trace, QualityRunNarrativeEvent, QualityRunSpan } from '@/types'

interface RunDetailProps {
  traceId: string
  /** Explicit lens from the URL; `undefined` = let the shell pick the default
   *  landing by archetype (eval/indexing → Summary, else Tree). */
  lens?: RunLens
  spanId?: string
  /** Eval/indexing Summary-tab landing (explicit `?summary=1`). */
  summary?: boolean
}

export function RunDetailShell({ traceId, lens, spanId: navSpanId, summary }: RunDetailProps) {
  const { navigate } = useNavigation()
  const { toast } = useToast()
  const judgeEvents = useJudgeEvents()
  // Suspends on first paint — caught by the App-level Suspense. Subsequent
  // refetches (per the hook's polling cadence) keep the previous detail visible.
  const detail = useQualityRunDetailSuspense(traceId)
  const canonicalHeader = useObservabilityGraph(traceId)

  const runDetail = canonicalHeader.runDetail
  const run = runDetail?.run
  const trace = detail.trace
  const target = detail.run.targetId ?? run?.promptId ?? run?.name ?? run?.rootPrimitive ?? traceId
  const duration = detail.run.durationMs ?? run?.durationMs
  const status = detail.run.status ?? run?.status ?? 'unknown'

  // Run identity + headline metrics for the shell header + context strip.
  const runName = run?.name ?? target
  const primitive = run?.rootPrimitive ?? detail.run.primitive ?? 'run'
  const tokens = run?.metrics?.totalTokens ?? detail.run.tokenCount
  const cost = run?.metrics?.costUsd ?? detail.run.cost
  const cacheRead = run?.metrics?.cacheReadTokens
  const spanCount = run?.spanCount
  const modelSummary = runDetail?.root.request?.modelSummary
  const model = modelSummary?.primaryModel ?? trace?.model ?? run?.model ?? detail.run.model
  const provider = modelSummary?.primaryProvider ?? run?.provider ?? detail.run.provider
  const modelExtraCount = modelSummary?.mixed ? Math.max(0, (modelSummary.models?.length ?? 1) - 1) : 0
  const diagnosticsCount = runDetail?.diagnostics?.length ?? 0

  // Shell subtitle: primitive · provider · model (+N when the run mixed models).
  const modelLabel = model ? `${model}${modelExtraCount > 0 ? ` +${modelExtraCount}` : ''}` : undefined
  const subtitleText = [primitive, provider, modelLabel].filter(Boolean).join(' · ')
  const safeSubtitleText = subtitleText.replace(/[^\x00-\x7F]+/g, '/')
  // When the run mixed models, list them all on hover.
  const modelTitle = modelSummary?.mixed
    ? modelSummary.models
        ?.map((entry) => [entry.provider, entry.model].filter(Boolean).join(' · '))
        .filter(Boolean)
        .join(', ')
        .replace(/[^\x00-\x7F]+/g, '/')
    : undefined
  const subtitle = modelTitle ? <span title={modelTitle}>{safeSubtitleText}</span> : safeSubtitleText

  // Archetype framing: eval/indexing get a leading Summary segment + land on
  // it by default; other shapes open in Tree. (Resolved here, not in the URL
  // codec, which only knows `traceId`.) See ARCHETYPES-PLAN.md.
  const archetype = runArchetype(primitive)
  const hasSummary = archetypeHasSummary(archetype)
  const showSummary = summary === true || (summary == null && lens == null && navSpanId == null && hasSummary)
  const effectiveLens: RunLens = lens ?? 'tree'
  const summaryNav = hasSummary
    ? { active: showSummary, onSelect: () => navigate({ view: 'run-detail', traceId, summary: true }) }
    : undefined
  const stripItems = archetypeStrip(
    archetype,
    { durationMs: duration, tokens, cost, cacheRead, spanCount, running: status === 'running' },
    runDetail?.root,
  )

  const selectLens = (l: RunLens) => navigate({ view: 'run-detail', traceId, lens: l, spanId: navSpanId })

  return (
    <QwShell
      activeView="runs"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb={`Inspect / Runs / ${traceId.slice(0, 12)}…`}
      title={runName}
      subtitle={subtitle}
      noScroll
      actions={
        <>
          <Btn
            size="sm"
            icon={<Icon name="layers" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Save as case',
                message: 'Saving a run as an eval case is coming soon.',
              })
            }
          >
            Save as case
          </Btn>
          <Btn size="sm" icon={<Icon name="compare" size={13} />} onClick={() => navigate({ view: 'compare' })}>
            Compare
          </Btn>
          <Btn size="sm" variant="primary" icon={<Icon name="play" size={13} />} onClick={() => selectLens('story')}>
            Replay
          </Btn>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <RunContextStrip status={status} items={stripItems} diagnosticsCount={diagnosticsCount} />
        {status === 'suspended' && <FlowSuspendedBanner root={runDetail?.root} />}
        <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: 'var(--qw-bg)' }}>
          <SectionBoundary
            title="Run detail"
            fallback={<RunDetailSkeleton lens={effectiveLens} />}
            resetKey={`${traceId}:${showSummary ? 'summary' : effectiveLens}`}
            invalidateKeys={[qk.quality.run(traceId), qk.observability.run(traceId)]}
          >
            {showSummary ? (
              <SummaryMode traceId={traceId} archetype={archetype} onSelectLens={selectLens} summaryNav={summaryNav} />
            ) : effectiveLens === 'graph' ? (
              <CanvasMode
                traceId={traceId}
                spanId={navSpanId}
                lens={effectiveLens}
                onSelectLens={selectLens}
                summaryNav={summaryNav}
                trace={trace}
                judges={judgeEvents.filter((j) => j.traceId === traceId)}
              />
            ) : effectiveLens === 'story' ? (
              <ReplayMode
                trace={trace}
                duration={duration}
                status={status}
                narrative={detail.narrative}
                spans={detail.spans}
                lens={effectiveLens}
                onSelectLens={selectLens}
                summaryNav={summaryNav}
              />
            ) : (
              // Key by lens so Tree↔Timeline remounts with its own default
              // structure width + inspector state (collapsed for Timeline).
              <InspectMode
                key={effectiveLens}
                traceId={traceId}
                spanId={navSpanId}
                trace={trace}
                judges={judgeEvents.filter((j) => j.traceId === traceId)}
                lens={effectiveLens}
                layout={effectiveLens === 'timeline' ? 'timeline' : 'tree'}
                onSelectLens={selectLens}
                summaryNav={summaryNav}
              />
            )}
          </SectionBoundary>
        </div>
      </div>
    </QwShell>
  )
}

// ─── Loading skeleton ───────────────────────────────────────────────

function RunDetailSkeleton({ lens }: { lens: RunLens }) {
  // Tree / timeline / graph lenses use a sidebar + detail layout. Story is a
  // single-column timeline. Match the shapes so the skeleton doesn't shift.
  if (lens === 'story') {
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
  lens,
  onSelectLens,
  summaryNav,
}: {
  trace: Trace | undefined
  duration: number | undefined
  status: string
  narrative?: readonly QualityRunNarrativeEvent[]
  spans?: readonly QualityRunSpan[]
  lens: RunLens
  onSelectLens: (lens: RunLens) => void
  summaryNav?: SummaryNav
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
    <div className="flex h-full min-h-0 flex-col" style={{ background: 'var(--qw-bg)' }}>
      {/* Lens switch — same left offset as the tree's, so it doesn't jump. */}
      <div
        className="flex flex-shrink-0 items-center gap-3 px-2.5 py-2"
        style={{ borderBottom: '1px solid var(--qw-border)' }}
      >
        <LensSwitch active={lens} onSelect={onSelectLens} dense summary={summaryNav} />
        <div className="flex-1" />
        <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {replayEvents.length} events ·{' '}
          {narrative && narrative.length > 0 ? 'narrative' : 'narrative derived from spans'}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <ReplayPlayer
          events={replayEvents}
          durationMs={timelineTotal}
          segments={segments}
          status={status}
          topMeta={topMeta}
        />
      </div>
    </div>
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
