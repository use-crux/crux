/**
 * Run archetypes (design `v9-archetypes`). The archetype is a property of a
 * *node* — the root primitive only sets the shell's default framing (which lens
 * leads, whether a Summary tab exists, what the header strip emphasises).
 *
 * See `docs/run-redesign/ARCHETYPES-PLAN.md` for the full model.
 */

import type { StatItem } from '@/features/run-detail/components/atoms'
import type { ObservabilityRunDetailNode } from '@/types'
import { findArtifact, fmtCost, fmtDuration, fmtTokens } from './span-detail-inspection'

export type RunArchetype = 'eval' | 'indexing' | 'swarm' | 'flow' | 'generic'

/** Classify a run/node by its (root) primitive. */
export function runArchetype(primitive: string | undefined): RunArchetype {
  const p = primitive ?? ''
  if (p.startsWith('eval.') || p.startsWith('scoring.')) return 'eval'
  if (p.startsWith('corpus.') || p.startsWith('indexing.') || p.startsWith('ingest.')) return 'indexing'
  if (p === 'composition.swarm') return 'swarm'
  if (p.startsWith('flow.')) return 'flow'
  return 'generic'
}

/** Eval and indexing runs land on a Summary tab by default; others open in a lens. */
export function archetypeHasSummary(a: RunArchetype): boolean {
  return a === 'eval' || a === 'indexing'
}

// ─── eval-case roll-up (shared by EvalRunCard + the header strip) ────

export interface EvalCaseRow {
  id: string
  name: string
  verdict?: string
  pass: boolean
  score?: number
  judgesPassed?: number
  judgesTotal?: number
}

interface ScoreReportShape {
  verdict?: string
  score?: number
  judges?: readonly { status?: string; score?: number; threshold?: number }[]
}

/** Every `eval.case` descendant of `root`, rolled up from its `score.report`. */
export function evalCasesOf(root: ObservabilityRunDetailNode | undefined): EvalCaseRow[] {
  if (!root) return []
  const rows: EvalCaseRow[] = []
  const walk = (n: ObservabilityRunDetailNode) => {
    if (n.primitive === 'eval.case' || n.primitive === 'scoring.case') {
      const raw = findArtifact(n, 'score.report')?.preview
      const report = (typeof raw === 'object' && raw !== null ? (raw as ScoreReportShape) : undefined) ?? undefined
      const judges = report?.judges ?? []
      const judgesPassed = judges.filter(
        (j) => j.status === 'passed' || (j.score != null && j.threshold != null && j.score >= j.threshold),
      ).length
      rows.push({
        id: n.id,
        name: n.display?.label ?? n.name ?? n.primitive ?? n.id,
        verdict: report?.verdict,
        pass:
          report?.verdict != null
            ? report.verdict === 'pass'
            : judges.length > 0 && judgesPassed === judges.length,
        score: report?.score,
        judgesPassed: judges.length ? judgesPassed : undefined,
        judgesTotal: judges.length || undefined,
      })
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(root)
  return rows
}

// ─── corpus / indexing totals ───────────────────────────────────────

interface ReportTotals {
  totals?: Record<string, number | undefined>
}

function indexingTotals(root: ObservabilityRunDetailNode | undefined): Record<string, number | undefined> {
  for (const kind of ['corpus.report', 'indexing.report'] as const) {
    const raw = findArtifact(root, kind)?.preview
    if (typeof raw === 'object' && raw !== null) return (raw as ReportTotals).totals ?? {}
  }
  return {}
}

// ─── archetype-specific header strip ────────────────────────────────

interface RunMetrics {
  durationMs?: number
  tokens?: number
  cost?: number
  cacheRead?: number
  spanCount?: number
  running?: boolean
}

/**
 * The curated metric strip for the run header, by archetype (design
 * `ArchSwarm`/`ArchFlow`/`ArchEval`/`ArchIndexing`). Universal metrics
 * (`dur`/`cost`) are whole-run rollups; archetype counts come from the root
 * node's report. `dur` (or `elapsed` while running) is always present.
 */
export function archetypeStrip(
  archetype: RunArchetype,
  m: RunMetrics,
  root: ObservabilityRunDetailNode | undefined,
): StatItem[] {
  const durItem: StatItem = { label: m.running ? 'elapsed' : 'dur', value: fmtDuration(m.durationMs) }
  const cost: StatItem = { label: 'cost', value: fmtCost(m.cost) }
  const tokens: StatItem = { label: 'tokens', value: fmtTokens(m.tokens) }

  switch (archetype) {
    case 'eval': {
      const cases = evalCasesOf(root)
      const passed = cases.filter((c) => c.pass).length
      const pct = cases.length ? Math.round((passed / cases.length) * 100) : undefined
      return [
        { label: 'cases', value: String(cases.length) },
        ...(pct != null
          ? [{ label: 'pass', value: `${pct}%`, tone: pct >= 80 ? 'ok' : pct >= 50 ? undefined : 'danger' } as StatItem]
          : []),
        cost,
      ]
    }
    case 'indexing': {
      const t = indexingTotals(root)
      const items: StatItem[] = []
      if (t.sources != null) items.push({ label: 'sources', value: String(t.sources) })
      if (t.chunks != null) items.push({ label: 'chunks', value: fmtTokens(t.chunks) })
      items.push(durItem, cost)
      return items
    }
    case 'swarm': {
      const raw = findArtifact(root, 'composition.report')?.preview as
        | { roster?: unknown[]; handoffPath?: unknown[]; handoffCount?: number }
        | undefined
      const agents = Array.isArray(raw?.roster) ? raw!.roster.length : undefined
      const hops = raw?.handoffCount ?? (Array.isArray(raw?.handoffPath) ? Math.max(0, raw!.handoffPath.length - 1) : undefined)
      return [
        ...(agents != null ? [{ label: 'agents', value: String(agents) } as StatItem] : []),
        ...(hops != null ? [{ label: 'hops', value: String(hops) } as StatItem] : []),
        durItem,
        tokens,
        cost,
      ]
    }
    case 'flow': {
      const steps = (root?.children ?? []).length
      return [{ label: 'steps', value: String(steps) }, durItem, cost]
    }
    default: {
      const items: StatItem[] = [durItem, tokens, cost]
      if (m.cacheRead != null) items.push({ label: 'cache', value: fmtTokens(m.cacheRead), tone: 'ok' })
      if (m.spanCount != null) items.push({ label: 'spans', value: String(m.spanCount) })
      return items
    }
  }
}
