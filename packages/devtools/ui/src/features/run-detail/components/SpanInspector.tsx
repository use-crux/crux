/**
 * The constant inspector rail (right pane).
 *
 * Same skeleton every time — sections fill in when the selected node carries
 * the data; the run root shows the run-level variant. Binds to the typed
 * `CruxRunDetailNode` from the observability projection (facts & quality;
 * the substance lives in the center Detail pane).
 *
 * Ported from the design's `v7-parts` `SpanInspector` / `v8` `InspectorPanel`
 * onto `--qw-*` tokens + the run-detail atoms.
 */

import { useMemo, type ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import { Chip, ScoreBar } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { useNavigation, type NavState } from '@/app/navigation/useNavigation'
import type { ObservabilityRunDetail, ObservabilityRunDetailNode } from '@/types'
import type { CruxCitationReportPreview, CruxScoreReportPreview } from '@use-crux/core/observability'
import { KindTag, StatusPill, type RunNodeKind } from './atoms'
import { routingFacts, governanceFacts } from './GenerationDecisions'
import {
  findArtifact,
  findNode,
  fmtCost,
  fmtDuration,
  fmtTokens,
  nodeCacheTokens,
  nodeCost,
  nodeDuration,
  nodeTokens,
  readMetric,
  shortModelId,
  tokensPerSecond,
} from '../lib/span-detail-inspection'

type Relation = ObservabilityRunDetailNode['relations'][number]
type Diagnostic = ObservabilityRunDetailNode['diagnostics'][number]

/** Narrow an artifact preview to a score report (judges attached to this node). */
function asScoreReport(preview: unknown): CruxScoreReportPreview | null {
  if (typeof preview === 'object' && preview !== null && (preview as { kind?: unknown }).kind === 'score.report') {
    return preview as CruxScoreReportPreview
  }
  return null
}

/** Narrow an artifact preview to a citation report (grounding for the output). */
function asCitationReport(preview: unknown): CruxCitationReportPreview | null {
  if (typeof preview === 'object' && preview !== null && (preview as { kind?: unknown }).kind === 'citation.report') {
    return preview as CruxCitationReportPreview
  }
  return null
}

// ─── small layout helpers ───────────────────────────────────────────

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b border-(--qw-border) px-4 py-3">
      <div className="mb-2 flex items-center">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--qw-fg-faint)' }}>
          {title}
        </span>
        <div className="flex-1" />
        {right}
      </div>
      {children}
    </div>
  )
}

function Metric({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div>
      <div className="text-[9.5px] uppercase tracking-[0.04em]" style={{ color: 'var(--qw-fg-faint)' }}>
        {k}
      </div>
      <div className="font-mono text-[13.5px] font-medium" style={{ color: tone ?? 'var(--qw-fg)' }}>
        {v}
      </div>
    </div>
  )
}

// ─── index link rows (contextual IDs → Project Index) ────────────

interface IndexLink {
  label: string
  value: string
  /** Nav target when the index has a home for this id; else plain text. */
  to?: NavState
}

function indexLinks(node: ObservabilityRunDetailNode): IndexLink[] {
  const out: IndexLink[] = []
  if (node.promptId)
    out.push({ label: 'prompt', value: node.promptId, to: { view: 'library-index', promptId: node.promptId } })
  if (node.contextId)
    out.push({ label: 'context', value: node.contextId, to: { view: 'library-index', contextId: node.contextId } })
  if (node.toolName)
    out.push({ label: 'tool', value: node.toolName, to: { view: 'library-index', toolName: node.toolName } })
  if (node.memoryId)
    out.push({ label: 'memory', value: node.memoryId, to: { view: 'library-memory', memoryId: node.memoryId } })
  // No dedicated index route yet — show as plain text (don't render a dead link).
  if (node.agentId) out.push({ label: 'agent', value: node.agentId })
  if (node.flowId) out.push({ label: 'flow', value: node.flowId })
  if (node.retrieverId) out.push({ label: 'retriever', value: node.retrieverId })
  return out
}

// ─── attributes (metadata catch-all) ────────────────────────────────

function attributeRows(node: ObservabilityRunDetailNode): { k: string; v: string }[] {
  const attrs = node.attributes
  if (!attrs || typeof attrs !== 'object') return []
  const rows: { k: string; v: string }[] = []
  for (const [k, raw] of Object.entries(attrs)) {
    if (k === 'presentation') continue // display hints, surfaced elsewhere
    if (raw == null) continue
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      rows.push({ k, v: String(raw) })
    }
  }
  return rows
}

// ─── relations ──────────────────────────────────────────────────────

function relationDirection(rel: Relation, spanId: string | undefined): 'in' | 'out' | '—' {
  if (!spanId) return '—'
  if (rel.from?.id === spanId) return 'out'
  if (rel.to?.id === spanId) return 'in'
  return '—'
}

function relationLabel(rel: Relation, spanId: string | undefined): string {
  const other = rel.from?.id === spanId ? rel.to : rel.from
  return other?.id ?? rel.edgeType
}

// ─── inspector ──────────────────────────────────────────────────────

export function SpanInspector({
  runDetail,
  selectedNodeId,
  onSelectSpan,
  onCollapse,
}: {
  runDetail: ObservabilityRunDetail | null
  selectedNodeId: string | null
  onSelectSpan: (id: string) => void
  onCollapse?: () => void
}) {
  const node = useMemo(() => {
    if (!runDetail) return null
    if (selectedNodeId) return findNode(runDetail.root, selectedNodeId)
    return runDetail.root
  }, [runDetail, selectedNodeId])

  const runLevel = !node || node.id === runDetail?.root.id || node.kind === 'run'

  if (!node) {
    return (
      <aside className="flex w-[288px] shrink-0 flex-col border-l border-(--qw-border) bg-(--qw-bg)">
        <InspectorHeader runLevel onCollapse={onCollapse} />
        <div className="px-4 py-6 text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
          Select a span to inspect.
        </div>
      </aside>
    )
  }

  const duration = nodeDuration(node)
  // Resolve every usage stat through `readMetric` (inspection rollup → metric
  // buckets → flat metrics → usage.observed events) so the inspector is as
  // complete as the span sub-header — cost / ttft / tps / reasoning included.
  const inTok = readMetric(node, 'inputTokens') ?? 0
  const outTok = readMetric(node, 'outputTokens') ?? 0
  const cacheTok = nodeCacheTokens(node) ?? 0
  const reasoningTok = readMetric(node, 'reasoningTokens')
  const tokens = nodeTokens(node) ?? (inTok + outTok > 0 ? inTok + outTok : undefined)
  const cost = nodeCost(node)
  const ttft = readMetric(node, 'ttftMs')
  const tps = readMetric(node, 'tokensPerSecond') ?? tokensPerSecond(node)
  const cacheRead = cacheTok || undefined
  const tokenSplitTotal = inTok + cacheTok + outTok

  const timing = node.timing
  const selfMs = timing?.selfMs
  const childrenMs = timing?.childrenMs
  const detailsMs = timing?.detailsMs
  const timingTotal = (selfMs ?? 0) + (childrenMs ?? 0) + (detailsMs ?? 0)

  const links = indexLinks(node)
  const relations = node.relations ?? []
  const diagnostics = node.diagnostics ?? []
  const attrs = attributeRows(node)

  const scoreReport = asScoreReport(findArtifact(node, 'score.report')?.preview)
  const judges = scoreReport?.judges ?? []

  const citationReport = asCitationReport(findArtifact(node, 'citation.report')?.preview)
  const citations = citationReport?.markers ?? []
  const grounded = citations.filter((c) => c.grounded).length

  // Routing/cascade folded onto this generation (design `CardRouting` InspectorPanel:
  // chosen · tiers · escalated · under-budget + Why). Folds the routing screen's
  // inspector into the generation's rail per the chosen UX.
  const routing = routingFacts(node)
  // The other governance screens' inspector facts (cache / guardrail / security /
  // constraint / compaction), folded into this span's rail alongside Routing.
  const govFacts = governanceFacts(node)

  return (
    <aside className="flex w-[288px] shrink-0 flex-col overflow-y-auto border-l border-(--qw-border) bg-(--qw-bg)">
      <InspectorHeader runLevel={runLevel} onCollapse={onCollapse} />

      {/* Identity */}
      <div className="border-b border-(--qw-border) px-4 py-3">
        <div className="mb-1 flex items-center gap-2">
          <KindTag kind={(node.display?.kind ?? node.kind) as RunNodeKind} primitive={node.primitive} size={9} />
          <span className="font-mono text-[11.5px] font-semibold">{node.primitive || node.kind}</span>
          <div className="flex-1" />
          <StatusPill status={node.status} />
        </div>
        <div className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {[
            shortId(node.spanId || node.id),
            node.parentSpanId ? `parent ${shortId(node.parentSpanId)}` : null,
            modelLine(node),
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-3 border-b border-(--qw-border) px-4 py-3">
        <Metric k="duration" v={fmtDuration(duration)} />
        {ttft != null && <Metric k="ttft" v={fmtDuration(ttft)} />}
        {tps != null && <Metric k="tps" v={Math.round(tps)} />}
        <Metric k="tokens" v={fmtTokens(tokens)} />
        {cacheRead != null && <Metric k="cache rd" v={fmtTokens(cacheRead)} tone="var(--qw-ok)" />}
        <Metric k="cost" v={fmtCost(cost)} />
      </div>

      {/* Routing — folded cascade/router decision (see Decisions tab for the body) */}
      {routing && (
        <Section title="Routing">
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            {routing.chosen && <Metric k="chosen" v={shortModelId(routing.chosen) ?? routing.chosen} />}
            {routing.classifiedAs && <Metric k="route" v={routing.classifiedAs} />}
            {routing.tiers != null && <Metric k="tiers" v={String(routing.tiers)} />}
            {routing.escalated != null && <Metric k="escalated" v={String(routing.escalated)} />}
            {routing.underBudget != null && (
              <Metric
                k="under budget"
                v={routing.underBudget ? 'yes' : 'no'}
                tone={routing.underBudget ? 'var(--qw-ok)' : 'var(--qw-warn)'}
              />
            )}
            {routing.budget != null && <Metric k="budget" v={fmtCost(routing.budget)} />}
          </div>
          {routing.why && (
            <div className="mt-2 text-[10.5px] leading-[1.5]" style={{ color: 'var(--qw-fg-muted)' }}>
              {routing.why}
            </div>
          )}
        </Section>
      )}

      {/* Governance — folded cache / guardrail / security / constraint /
          compaction facts (each screen's InspectorPanel; body in its tab). */}
      {govFacts.map((gf) => (
        <Section key={gf.type} title={gf.label}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            {gf.rows.map(([k, v, tone]) => (
              <Metric key={k} k={k} v={v} tone={tone} />
            ))}
          </div>
          {gf.note && (
            <div className="mt-2 text-[10.5px] leading-[1.5]" style={{ color: 'var(--qw-fg-muted)' }}>
              {gf.note}
            </div>
          )}
        </Section>
      ))}

      {/* Timing split */}
      {timingTotal > 0 && (
        <Section title="Timing · self vs children">
          <div
            className="flex h-4 overflow-hidden rounded-[6px]"
            style={{ boxShadow: 'inset 0 0 0 1px var(--qw-border)' }}
          >
            {selfMs ? (
              <span
                style={{ width: pct(selfMs, timingTotal), background: 'var(--qw-warn)', opacity: 0.8 }}
                title={`self ${fmtDuration(selfMs)}`}
              />
            ) : null}
            {childrenMs ? (
              <span
                style={{ width: pct(childrenMs, timingTotal), background: 'var(--qw-crux)', opacity: 0.8 }}
                title={`children ${fmtDuration(childrenMs)}`}
              />
            ) : null}
            {detailsMs ? (
              <span
                style={{ width: pct(detailsMs, timingTotal), background: 'var(--qw-iris)', opacity: 0.8 }}
                title={`details ${fmtDuration(detailsMs)}`}
              />
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {selfMs ? (
              <span>
                <span style={{ color: 'var(--qw-warn)' }}>■</span> self {fmtDuration(selfMs)}
              </span>
            ) : null}
            {childrenMs ? (
              <span>
                <span style={{ color: 'var(--qw-crux)' }}>■</span> children {fmtDuration(childrenMs)}
              </span>
            ) : null}
            {detailsMs ? (
              <span>
                <span style={{ color: 'var(--qw-iris)' }}>■</span> details {fmtDuration(detailsMs)}
              </span>
            ) : null}
          </div>
        </Section>
      )}

      {/* Cost split — token breakdown (in · cache · out) */}
      {tokenSplitTotal > 0 && (
        <Section
          title="Cost split"
          right={
            <span className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {fmtCost(cost)}
            </span>
          }
        >
          <div
            className="flex h-5 overflow-hidden rounded-[6px]"
            style={{ boxShadow: 'inset 0 0 0 1px var(--qw-border)' }}
          >
            {inTok ? (
              <span
                style={{ width: pct(inTok, tokenSplitTotal), background: 'var(--qw-crux)', opacity: 0.85 }}
                title={`input ${fmtTokens(inTok)}`}
              />
            ) : null}
            {cacheTok ? (
              <span
                style={{ width: pct(cacheTok, tokenSplitTotal), background: 'var(--qw-ok)', opacity: 0.85 }}
                title={`cache ${fmtTokens(cacheTok)}`}
              />
            ) : null}
            {outTok ? (
              <span
                style={{ width: pct(outTok, tokenSplitTotal), background: 'var(--qw-iris)', opacity: 0.85 }}
                title={`output ${fmtTokens(outTok)}`}
              />
            ) : null}
          </div>
          <div
            className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10.5px]"
            style={{ color: 'var(--qw-fg-muted)' }}
          >
            {inTok ? (
              <span>
                <span style={{ color: 'var(--qw-crux)' }}>■</span> in · fresh {fmtTokens(inTok)}
              </span>
            ) : null}
            {cacheTok ? (
              <span>
                <span style={{ color: 'var(--qw-ok)' }}>■</span> cache read {fmtTokens(cacheTok)}
              </span>
            ) : null}
            {outTok ? (
              <span>
                <span style={{ color: 'var(--qw-iris)' }}>■</span> out {fmtTokens(outTok)}
              </span>
            ) : null}
            {reasoningTok ? (
              <span>
                <span style={{ color: 'var(--qw-warn)' }}>■</span> reasoning {fmtTokens(reasoningTok)}
              </span>
            ) : null}
          </div>
        </Section>
      )}

      {/* Grounding — citations resolve against the shared source pool */}
      {citations.length > 0 && (
        <Section
          title="Grounding"
          right={
            <Chip tone={grounded === citations.length ? 'ok' : 'warn'} dot>
              {grounded} / {citations.length}
            </Chip>
          }
        >
          <div className="flex flex-col gap-1.5">
            {citations.map((c, i) => (
              <div
                key={`${c.marker}:${i}`}
                className="flex items-center gap-2"
                style={{ opacity: c.grounded ? 1 : 0.7 }}
              >
                <span
                  className="w-[26px] font-mono text-[10px]"
                  style={{ color: c.grounded ? 'var(--qw-crux)' : 'var(--qw-fg-faint)' }}
                >
                  {c.marker != null ? `[${c.marker}]` : '—'}
                </span>
                <span
                  className="flex-1 truncate font-mono text-[10.5px]"
                  style={{ color: 'var(--qw-fg-muted)' }}
                  title={c.sourceId}
                >
                  {c.sourceId ?? c.chunkId ?? '—'}
                </span>
                {c.grounded && c.score != null ? (
                  <span className="font-mono text-[10px]" style={{ color: 'var(--qw-ok)' }}>
                    {c.score.toFixed(2)}
                  </span>
                ) : (
                  <span className="font-mono text-[9.5px]" style={{ color: 'var(--qw-warn)' }}>
                    {c.note ?? 'unused'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Index */}
      {links.length > 0 && (
        <Section title="Index">
          {links.map((l) => (
            <IndexRow key={`${l.label}:${l.value}`} link={l} />
          ))}
        </Section>
      )}

      {/* Relations */}
      {relations.length > 0 && (
        <Section title={`Relations · ${relations.length}`}>
          <div className="flex flex-col gap-1">
            {relations.map((rel) => (
              <div key={rel.edgeId} className="flex items-center gap-2 py-0.5">
                <span className="w-5 font-mono text-[9px] uppercase" style={{ color: 'var(--qw-fg-faint)' }}>
                  {relationDirection(rel, node.spanId)}
                </span>
                <span className="font-mono text-[10px]" style={{ color: 'var(--qw-crux)' }}>
                  {rel.edgeType}
                </span>
                <span className="flex-1 truncate font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  {relationLabel(rel, node.spanId)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Scores — judges attached to this node */}
      {judges.length > 0 && (
        <Section title="Scores">
          <div className="flex flex-col gap-2">
            {judges.map((j) => {
              const passed = j.status === 'passed' || (j.score != null && j.threshold != null && j.score >= j.threshold)
              const color = passed ? 'var(--qw-ok)' : 'var(--qw-warn)'
              return (
                <div key={j.name} className="flex items-center gap-2">
                  <span className="flex-1 truncate font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                    {j.name}
                  </span>
                  {j.score != null && <ScoreBar score={j.score} threshold={j.threshold} color={color} />}
                  {j.score != null && (
                    <span className="w-7 text-right font-mono text-[10.5px] font-semibold" style={{ color }}>
                      {j.score.toFixed(2)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      {/* Diagnostics */}
      {diagnostics.length > 0 && (
        <Section title={`Diagnostics · ${diagnostics.length}`}>
          <div className="flex flex-col gap-2">
            {diagnostics.map((d) => (
              <DiagnosticRow key={d.code + d.message} diag={d} onJump={onSelectSpan} />
            ))}
          </div>
        </Section>
      )}

      {/* Attributes */}
      {attrs.length > 0 && (
        <Section title={`Attributes · ${attrs.length}`}>
          <div className="overflow-hidden rounded-[6px]" style={{ border: '1px solid var(--qw-border)' }}>
            {attrs.map((row, i) => (
              <div
                key={row.k}
                className="flex justify-between gap-2 px-2.5 py-1"
                style={{
                  borderTop: i ? '1px solid var(--qw-border)' : 'none',
                  background: i % 2 ? 'var(--qw-bg)' : 'var(--qw-bg-elev)',
                }}
              >
                <span className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  {row.k}
                </span>
                <span className="truncate pl-2 font-mono text-[10px]" style={{ color: 'var(--qw-fg)' }}>
                  {row.v}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </aside>
  )
}

// ─── header ─────────────────────────────────────────────────────────

function InspectorHeader({ runLevel, onCollapse }: { runLevel: boolean; onCollapse?: () => void }) {
  return (
    <div className="sticky top-0 z-[1] flex items-center gap-2 border-b border-(--qw-border) bg-(--qw-bg) px-4 py-2.5">
      <Icon name="list" size={13} color="var(--qw-fg-muted)" />
      <span className="font-mono text-[11px] uppercase tracking-[0.04em]" style={{ color: 'var(--qw-fg-muted)' }}>
        inspector · {runLevel ? 'run' : 'span'}
      </span>
      <div className="flex-1" />
      {onCollapse && (
        <button type="button" onClick={onCollapse} title="Collapse inspector" className="cursor-pointer">
          <Icon name="arrowRight" size={13} color="var(--qw-fg-faint)" />
        </button>
      )}
    </div>
  )
}

function IndexRow({ link }: { link: IndexLink }) {
  const { navigate } = useNavigation()
  const clickable = link.to != null
  return (
    <div
      className={cn('flex items-center gap-2 py-0.5', clickable && 'cursor-pointer')}
      onClick={clickable ? () => navigate(link.to as NavState) : undefined}
    >
      <span className="w-[52px] font-mono text-[9.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
        {link.label}
      </span>
      <span
        className="flex-1 truncate font-mono text-[11px]"
        style={{ color: clickable ? 'var(--qw-crux)' : 'var(--qw-fg-muted)' }}
      >
        {link.value}
      </span>
      {clickable && <Icon name="link" size={11} color="var(--qw-fg-faint)" />}
    </div>
  )
}

function DiagnosticRow({ diag, onJump }: { diag: Diagnostic; onJump: (id: string) => void }) {
  const tone = diag.severity === 'error' ? 'danger' : diag.severity === 'warn' ? 'warn' : 'muted'
  const target = diag.spanIds?.[0]
  return (
    <div
      className="rounded-[6px] px-2.5 py-2"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <div className="mb-1 flex items-center gap-2">
        <Chip tone={tone} dot>
          {diag.code}
        </Chip>
        {target && (
          <button
            type="button"
            onClick={() => onJump(target)}
            className="ml-auto cursor-pointer font-mono text-[10px]"
            style={{ color: 'var(--qw-crux)' }}
          >
            jump →
          </button>
        )}
      </div>
      <div className="text-[11px]" style={{ color: 'var(--qw-fg)' }}>
        {diag.message}
      </div>
      {diag.suggestedFix && (
        <div className="mt-1 text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          fix · {diag.suggestedFix}
        </div>
      )}
    </div>
  )
}

// ─── tiny helpers ───────────────────────────────────────────────────

function shortId(id: string | undefined): string {
  if (!id) return ''
  return id.length > 12 ? `${id.slice(0, 10)}…` : id
}

function modelLine(node: ObservabilityRunDetailNode): string | null {
  if (node.provider && node.model) return `${node.provider}/${node.model}`
  return node.model || node.provider || null
}

function pct(value: number, total: number): string {
  return `${Math.max(0, Math.min(100, (value / total) * 100))}%`
}

/** Collapsed inspector — a thin rail that re-expands on click. */
export function InspectorRail({ onExpand }: { onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      title="Expand inspector"
      className="flex w-14 shrink-0 cursor-pointer flex-col items-center gap-2 border-l border-(--qw-border) bg-(--qw-bg) py-3"
    >
      <Icon name="arrowUp" size={13} color="var(--qw-fg-faint)" className="rotate-[-90deg]" />
      <span
        className="font-mono text-[10px] uppercase tracking-[0.1em]"
        style={{ color: 'var(--qw-fg-faint)', writingMode: 'vertical-rl' }}
      >
        inspector
      </span>
    </button>
  )
}
