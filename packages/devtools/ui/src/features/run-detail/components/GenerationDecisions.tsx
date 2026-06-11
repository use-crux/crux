/**
 * Generation **Routing** tab — surfaces the routing / governance spans the backend
 * *folds* onto a generation (contract: `canonicalParentSpanId` points the
 * router/cascade/constraint/guardrail/security at the generation it decided for, so
 * they arrive in `node.details[]` rather than as standalone tree rows).
 *
 * Nothing else in the UI reads `node.details[]`, so without this tab the folded
 * decision evidence ("why this model / which tier / what budget") is dropped on the
 * floor even though the backend emits it correctly.
 *
 * Built to the design's `v12-cards-more` `CardRouting` (escalating tiers + fallback),
 * folded into a generation tab per the chosen UX (option 1): the screen *body* lives
 * here; the screen's *inspector* facts (`routingFacts`) fold into the generation's
 * Inspector rail (`SpanInspector`). The kind is labelled **routing**, not the
 * artboard's "generation".
 *
 * Data source: the canonical typed **`routing.report`** artifact
 * (`CruxRoutingReportPreview`) the backend emits on the `cascade.resolve` /
 * `router.resolve` span — NOT a hand-rolled attribute reconstruction (that double-
 * rendered alongside this). The carrying span's `attributes` supply only the facts
 * the report omits (totalTiers · budget · acceptedAtTier · budgetExceeded).
 */

import { type ReactNode } from 'react'
import type {
  CruxCacheReportPreview,
  CruxCompactionReportPreview,
  CruxConstraintReportPreview,
  CruxGuardrailReportPreview,
  CruxRoutingReportPreview,
  CruxRoutingTierPreview,
  CruxRunDetailDetail,
  CruxSecurityReportPreview,
} from '@crux/core/observability'
import { Chip, Eyebrow } from '@/qw/shell/primitives'
import type { ObservabilityRunDetailNode } from '@/types'
import { OperationReportFor } from './PrimitiveCards'
import { EmptyHint } from './SpanDetailPanelAtoms'
import { findArtifact, fmtCost, fmtTokens, shortModelId } from '../lib/span-detail-inspection'

// Governance presence + per-type tabs live further down (`presentGovernance`,
// `GovernanceTab`, `governanceFacts`). Routing keeps its dedicated path.

// ─── typed accessors (no `any`; narrow `unknown`) ────────────────────

function attrsOf(d: CruxRunDetailDetail): Record<string, unknown> {
  return (d.attributes ?? {}) as Record<string, unknown>
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
function isRoutingReport(v: unknown): v is CruxRoutingReportPreview {
  return typeof v === 'object' && v !== null && (v as { kind?: unknown }).kind === 'routing.report'
}

/** A folded routing decision: the typed report + the carrying span's facts. */
interface FoldedRouting {
  report: CruxRoutingReportPreview
  /** `cascade.resolve` / `router.resolve` attributes — for facts the report omits. */
  attrs: Record<string, unknown>
  status: string
}

function foldedRoutingReports(node: ObservabilityRunDetailNode): FoldedRouting[] {
  const out: FoldedRouting[] = []
  for (const d of node.details ?? []) {
    for (const a of d.artifacts ?? []) {
      if (a.kind === 'routing.report' && isRoutingReport(a.preview)) {
        out.push({ report: a.preview, attrs: attrsOf(d), status: d.status })
      }
    }
  }
  return out
}

// ─── routing facts (folded into the generation Inspector — design InspectorPanel) ──

export interface RoutingFacts {
  chosen?: string
  classifiedAs?: string
  tiers?: number
  escalated?: number
  underBudget?: boolean
  budget?: number
  why?: string
}

/** Extract the routing decision facts for the generation's Inspector rail. */
export function routingFacts(node: ObservabilityRunDetailNode): RoutingFacts | null {
  const routings = foldedRoutingReports(node)
  if (routings.length === 0) return null
  const { report, attrs } = routings[0]

  const facts: RoutingFacts = {
    chosen: report.chosen ?? report.selectedModel,
    classifiedAs: report.classifiedAs,
  }

  if (report.routingKind === 'cascade') {
    facts.tiers = num(attrs.totalTiers)
    facts.escalated = num(attrs.acceptedAtTier)
    facts.budget = num(attrs.maxCost)
    facts.underBudget = attrs.budgetExceeded === true ? false : attrs.budgetExceeded === false ? true : undefined
    const emitted = report.tiers?.length ?? 0
    const notReached = facts.tiers != null ? Math.max(0, facts.tiers - emitted) : 0
    if (facts.escalated != null && facts.tiers != null) {
      const parts = [`accepted at tier ${facts.escalated + 1} of ${facts.tiers}`]
      if (facts.escalated > 0) parts.push(`escalated ${facts.escalated}`)
      if (notReached > 0) parts.push(`${notReached} tier${notReached === 1 ? '' : 's'} not reached`)
      facts.why = parts.join('; ') + '.'
    }
  }

  return facts
}

// ─── section (design Sec) ────────────────────────────────────────────

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <Eyebrow>{title}</Eyebrow>
        <div className="h-px flex-1" style={{ background: 'var(--qw-border)' }} />
        {right}
      </div>
      {children}
    </div>
  )
}

// ─── router report (classify → model) ────────────────────────────────
// Rendered flat (no inner card frame) — the Routing tab is already the pane.

function RouterReport({ report }: { report: CruxRoutingReportPreview }) {
  const classifiedAs = report.classifiedAs
  const selectedModel = report.selectedModel ?? report.chosen
  const routes = report.availableRoutes ?? []
  const short = selectedModel ? (shortModelId(selectedModel) ?? selectedModel) : undefined

  return (
    <Section
      title="Router · classify → model"
      right={
        short ? (
          <Chip tone="ok" mono>
            {short}
          </Chip>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-2 font-mono text-[12px]">
        {classifiedAs && (
          <span
            className="rounded-[4px] px-2 py-0.5"
            style={{ background: 'var(--qw-crux-soft)', color: 'var(--qw-crux)' }}
          >
            {classifiedAs}
          </span>
        )}
        <span style={{ color: 'var(--qw-fg-faint)' }}>→</span>
        <span className="font-semibold" style={{ color: 'var(--qw-fg)' }}>
          {selectedModel ?? '—'}
        </span>
      </div>
      {routes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {routes.map((r) => {
            const chosen = r === classifiedAs
            return (
              <span
                key={r}
                className="rounded-[4px] px-1.5 py-0.5 font-mono text-[10.5px]"
                style={{
                  background: chosen ? 'var(--qw-crux-soft)' : 'var(--qw-bg-muted)',
                  color: chosen ? 'var(--qw-crux)' : 'var(--qw-fg-faint)',
                  border: `1px solid ${chosen ? 'var(--qw-crux-line)' : 'transparent'}`,
                }}
              >
                {r}
              </span>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ─── cascade report (design CardRouting — escalating tiers + fallback) ──

const VERDICT_TONE: Record<string, 'ok' | 'warn' | 'muted'> = {
  accepted: 'ok',
  rejected: 'warn',
  error: 'warn',
  skipped: 'muted',
  'not-reached': 'muted',
}

/** Per-tier note (design column: "confidence 0.93 ✓" / "tier not reached").
 *  Prefers the backend `confidence` (with a verdict mark), then the supplied `note`,
 *  then text derived from the verdict. */
function tierNote(tier: CruxRoutingTierPreview): string {
  if (typeof tier.confidence === 'number') {
    const mark = tier.verdict === 'accepted' ? ' ✓' : tier.verdict === 'rejected' ? ' ✗' : ''
    return `confidence ${tier.confidence.toFixed(2)}${mark}`
  }
  if (tier.note) return tier.note
  switch (tier.verdict) {
    case 'accepted':
      return 'accepted'
    case 'rejected':
      return 'below threshold'
    case 'skipped':
    case 'not-reached':
      return 'tier not reached'
    case 'error':
      return 'tier errored'
    default:
      return tier.verdict ?? ''
  }
}

/** Cascade budget dimension → section-title qualifier ("Cost" / "Latency"). */
function cascadeKind(attrs: Record<string, unknown>): string {
  if (attrs.hasCostBudget === true) return 'Cost cascade'
  if (attrs.hasLatencyBudget === true) return 'Latency cascade'
  return 'Cascade'
}

function CascadeReport({ report, attrs }: { report: CruxRoutingReportPreview; attrs: Record<string, unknown> }) {
  const tiers = report.tiers ?? []
  const totalTiers = num(attrs.totalTiers)
  const maxCost = num(attrs.maxCost)
  const budgetExceeded = attrs.budgetExceeded === true
  const chosen = report.chosen ? (shortModelId(report.chosen) ?? report.chosen) : undefined
  const notReached = totalTiers != null ? Math.max(0, totalTiers - tiers.length) : 0

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={`${cascadeKind(attrs)} · escalating tiers`}
        right={
          chosen ? (
            <Chip tone="ok" mono>
              {chosen}
            </Chip>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-2">
          {tiers.map((tr, i) => {
            const accepted = tr.verdict === 'accepted'
            const dim = tr.verdict === 'skipped' || tr.verdict === 'not-reached'
            const price = tr.cost ?? tr.budget
            return (
              <div
                key={`${tr.tier}-${tr.model}-${i}`}
                className="flex items-center gap-[11px] rounded-[8px] px-[13px] py-[11px]"
                style={{
                  background: 'var(--qw-bg-elev)',
                  border: `1px solid ${accepted ? 'var(--qw-ok-soft)' : 'var(--qw-border)'}`,
                  opacity: dim ? 0.55 : 1,
                }}
              >
                <span className="font-mono text-[10px]" style={{ width: 14, color: 'var(--qw-fg-faint)' }}>
                  {tr.tier + 1}
                </span>
                <span className="truncate font-mono text-[12.5px] font-semibold" style={{ width: 110 }}>
                  {shortModelId(tr.model) ?? tr.model}
                </span>
                <span className="font-mono text-[11px]" style={{ width: 64, color: 'var(--qw-fg-muted)' }}>
                  {price != null ? fmtCost(price) : ''}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  {tierNote(tr)}
                </span>
                <Chip tone={VERDICT_TONE[tr.verdict ?? ''] ?? 'muted'} dot>
                  {tr.verdict ?? '—'}
                </Chip>
              </div>
            )
          })}

          {/* The runtime emits a span only for *attempted* tiers, so higher tiers
              that were never reached have no model recorded (see filed backend gap).
              Surface the ladder honestly rather than silently hiding them. */}
          {notReached > 0 && (
            <div
              className="flex items-center gap-[11px] rounded-[8px] px-[13px] py-[11px]"
              style={{ border: '1px dashed var(--qw-border)', opacity: 0.6 }}
            >
              <span className="font-mono text-[10px]" style={{ width: 14, color: 'var(--qw-fg-faint)' }}>
                {tiers.length + 1}
              </span>
              <span className="min-w-0 flex-1 text-[11.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {notReached} higher tier{notReached === 1 ? '' : 's'} configured · not reached (model not recorded)
              </span>
              <Chip tone="muted" dot>
                skipped
              </Chip>
            </div>
          )}
        </div>
      </Section>

      <div
        className="rounded-[8px] px-[13px] py-2.5 font-mono text-[11.5px]"
        style={{ border: '1px dashed var(--qw-border)', color: 'var(--qw-fg-muted)' }}
      >
        {maxCost != null ? `Cascade escalated under a ${fmtCost(maxCost)} cost budget` : 'Cascade escalated'}
        {budgetExceeded ? ' (budget exceeded)' : ''}. A fallback.attempt edge would appear here if a tier had errored.
      </div>
    </div>
  )
}

function RoutingReportCard({ folded }: { folded: FoldedRouting }) {
  if (folded.report.routingKind === 'router') {
    return <RouterReport report={folded.report} />
  }
  return <CascadeReport report={folded.report} attrs={folded.attrs} />
}

// ─── tab body ────────────────────────────────────────────────────────

// ─── per-type governance tabs (each its own tab, like Routing) ──────────

export type GovType = 'routing' | 'guardrail' | 'security' | 'constraint' | 'cache' | 'compaction'

const GOV_REPORT_KIND: Record<GovType, string> = {
  routing: 'routing.report',
  guardrail: 'guardrail.report',
  security: 'security.report',
  constraint: 'constraint.report',
  cache: 'cache.report',
  compaction: 'compaction.report',
}
export const GOV_LABEL: Record<GovType, string> = {
  routing: 'Routing',
  guardrail: 'Guardrail',
  security: 'Security',
  constraint: 'Constraint',
  cache: 'Cache',
  compaction: 'Compaction',
}
const GOV_ORDER: readonly GovType[] = ['routing', 'guardrail', 'security', 'constraint', 'cache', 'compaction']

/** Which governance types are folded onto this span — one tab each. */
export function presentGovernance(node: ObservabilityRunDetailNode): GovType[] {
  return GOV_ORDER.filter((t) => findArtifact(node, GOV_REPORT_KIND[t]) !== null)
}

/** Center body for a governance tab. Routing keeps its rich cascade card (it
 *  carries the resolving span's attrs); the rest use the canonical report cards. */
export function GovernanceTab({ node, type }: { node: ObservabilityRunDetailNode; type: GovType }) {
  if (type === 'routing') {
    const routings = foldedRoutingReports(node)
    if (routings.length === 0) return <EmptyHint>No routing decision folded onto this generation.</EmptyHint>
    return (
      <div className="flex flex-col gap-5">
        {routings.map((folded, i) => (
          <RoutingReportCard key={i} folded={folded} />
        ))}
      </div>
    )
  }
  return <OperationReportFor node={node} kind={GOV_REPORT_KIND[type]} />
}

// ─── inspector facts per governance screen (folded into the span's rail) ──

function reportPreview<T>(node: ObservabilityRunDetailNode, kind: string): T | undefined {
  const p = findArtifact(node, kind)?.preview
  return typeof p === 'object' && p !== null && (p as { kind?: unknown }).kind === kind ? (p as T) : undefined
}

export interface GovFacts {
  type: GovType
  label: string
  rows: [string, string, string?][]
  note?: string
}

/** The governance screens' `InspectorPanel` facts, to fold into the span's
 *  Inspector rail (routing has its own dedicated fold via `routingFacts`). */
export function governanceFacts(node: ObservabilityRunDetailNode): GovFacts[] {
  const out: GovFacts[] = []

  const cache = reportPreview<CruxCacheReportPreview>(node, 'cache.report')
  if (cache) {
    const rows: [string, string, string?][] = [
      ['result', String(cache.status ?? '—'), cache.status === 'hit' ? 'var(--qw-ok)' : undefined],
    ]
    if (cache.saved?.tokens != null) rows.push(['saved tok', fmtTokens(cache.saved.tokens)])
    if (cache.saved?.costUsd != null) rows.push(['saved', fmtCost(cache.saved.costUsd)])
    if (cache.saved?.latencyMs != null) rows.push(['saved ms', String(Math.round(cache.saved.latencyMs))])
    out.push({ type: 'cache', label: 'Cache', rows })
  }

  const g = reportPreview<CruxGuardrailReportPreview>(node, 'guardrail.report')
  if (g) {
    const rows: [string, string, string?][] = []
    if (g.phase) rows.push(['phase', g.phase])
    if (g.action)
      rows.push([
        'action',
        g.action,
        g.action === 'block' ? 'var(--qw-danger)' : g.action === 'pass' ? 'var(--qw-ok)' : 'var(--qw-warn)',
      ])
    if (g.matches?.length) rows.push(['matches', String(g.matches.length)])
    out.push({ type: 'guardrail', label: 'Guardrail', rows, note: g.reason })
  }

  const s = reportPreview<CruxSecurityReportPreview>(node, 'security.report')
  if (s) {
    const rows: [string, string, string?][] = []
    if (s.pattern) rows.push(['type', s.pattern])
    if (s.severity) rows.push(['severity', s.severity, s.severity === 'error' ? 'var(--qw-danger)' : 'var(--qw-warn)'])
    if (s.action) rows.push(['action', s.action, 'var(--qw-warn)'])
    out.push({ type: 'security', label: 'Security', rows, note: s.message })
  }

  const c = reportPreview<CruxConstraintReportPreview>(node, 'constraint.report')
  if (c) {
    const attempts = c.attempts ?? []
    const rows: [string, string, string?][] = [['attempts', String(attempts.length)]]
    if (c.pass != null) rows.push(['passed', c.pass ? 'yes' : 'no', c.pass ? 'var(--qw-ok)' : 'var(--qw-warn)'])
    if (attempts.length > 1) rows.push(['retries', String(attempts.length - 1)])
    out.push({ type: 'constraint', label: 'Constraint', rows, note: c.assertion ?? c.constraint })
  }

  const cp = reportPreview<CruxCompactionReportPreview>(node, 'compaction.report')
  if (cp) {
    const before = cp.beforeTokens
    const after = cp.afterTokens
    const pct =
      cp.compressionRatio != null
        ? Math.round(cp.compressionRatio * 100)
        : before && after != null
          ? Math.round((1 - after / before) * 100)
          : undefined
    const rows: [string, string, string?][] = []
    if (before != null) rows.push(['before', fmtTokens(before)])
    if (after != null) rows.push(['after', fmtTokens(after)])
    if (pct != null) rows.push(['saved', `${pct}%`, 'var(--qw-ok)'])
    out.push({ type: 'compaction', label: 'Compaction', rows })
  }

  return out
}
