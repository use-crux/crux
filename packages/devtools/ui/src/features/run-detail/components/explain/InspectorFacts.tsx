/**
 * Right-inspector Explain facts — the compact read-out that rides alongside the
 * span rail. For a generation turn it answers "why Explain opened" plus the
 * saw/checked/dropped/freshness/cache/quality facts; for the run root it shows
 * the failing-first roll-up across every turn's report. Facts only — the rail
 * never owns the deep evidence.
 */

import type { ReactNode } from 'react'
import { turnHasWarningSignal } from '@/features/run-detail/lib/explain/signals'
import { aggregateRun, type RunAggregate } from '@/features/run-detail/lib/explain/rollup'
import type { TurnDecisionReport } from '@/types'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-(--qw-border) px-4 py-3">
      <div
        className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em]"
        style={{ color: 'var(--qw-fg-faint)' }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function Fact({ k, v, tone }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="font-mono text-[9px] uppercase tracking-[0.04em]" style={{ color: 'var(--qw-fg-faint)' }}>
        {k}
      </span>
      <span className="font-mono text-[11.5px] font-medium" style={{ color: tone ?? 'var(--qw-fg)' }}>
        {v}
      </span>
    </div>
  )
}

/** The single most notable degraded freshness state across the turn, or null. */
function dominantFreshness(report: TurnDecisionReport): string | null {
  for (const want of ['stale-used', 'stale-rejected', 'unknown', 'refreshed']) {
    if (report.freshness.some((f) => f.status === want)) return want
  }
  return report.freshness.length > 0 ? 'fresh' : null
}

/** One short sentence on why this turn leads with Explain (or that it is clean). */
function attentionReason(report: TurnDecisionReport): string {
  if (!turnHasWarningSignal(report)) return 'No warning signal — opened Output.'
  const reasons: string[] = []
  if (report.turn.status && report.turn.status !== 'ok') reasons.push(report.turn.status)
  if (report.considered.some((c) => c.required && c.disposition === 'dropped')) reasons.push('required context dropped')
  if (report.freshness.some((f) => f.status === 'stale-used')) reasons.push('stale evidence used')
  if (report.decisions.some((d) => d.reason.code.startsWith('routing.fallback'))) reasons.push('fallback fired')
  return reasons.length > 0 ? `Opened Explain · ${reasons.join(', ')}.` : 'Opened Explain.'
}

/** Compact per-turn facts for the inspector rail. */
export function TurnInspectorFacts({ report }: { report: TurnDecisionReport }) {
  const checked = report.considered.filter((c) => c.disposition === 'checked').length
  const dropped = report.considered.filter((c) => c.disposition === 'dropped').length
  const fresh = dominantFreshness(report)
  const cacheHit = report.cache.some((c) => c.status === 'hit')
  const cov = report.coverage
  const covered = cov.total > 0 ? `${cov.covered}/${cov.total}` : '—'
  return (
    <Section title="Explain">
      <div className="grid grid-cols-3 gap-x-3 gap-y-3">
        <Fact k="saw" v={report.saw.length} />
        <Fact k="checked" v={checked} />
        <Fact k="dropped" v={dropped} tone={dropped > 0 ? 'var(--qw-danger)' : undefined} />
        {fresh && <Fact k="freshness" v={fresh} tone={fresh === 'stale-used' ? 'var(--qw-warn)' : undefined} />}
        <Fact k="cache" v={cacheHit ? 'hit' : '—'} tone={cacheHit ? 'var(--qw-crux)' : undefined} />
        <Fact
          k="quality"
          v={covered}
          tone={cov.total > 0 && cov.covered < cov.total ? 'var(--qw-warn)' : 'var(--qw-ok)'}
        />
      </div>
      <div className="mt-2 text-[10.5px] leading-[1.5]" style={{ color: 'var(--qw-fg-muted)' }}>
        {attentionReason(report)}
      </div>
    </Section>
  )
}

function RunInsightBody({ agg }: { agg: RunAggregate }) {
  const covered = agg.total > 0 ? `${agg.covered}/${agg.total}` : '—'
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-3">
      <Fact k="turns" v={agg.turns} />
      <Fact k="attention" v={agg.needAttention} tone={agg.needAttention > 0 ? 'var(--qw-warn)' : 'var(--qw-ok)'} />
      <Fact k="dropped" v={agg.dropped} tone={agg.dropped > 0 ? 'var(--qw-danger)' : undefined} />
      <Fact k="stale used" v={agg.staleUsed} tone={agg.staleUsed > 0 ? 'var(--qw-warn)' : undefined} />
      <Fact k="fallback" v={agg.fallback} tone={agg.fallback > 0 ? 'var(--qw-warn)' : undefined} />
      <Fact k="protected" v={covered} tone={agg.total > 0 && agg.covered < agg.total ? 'var(--qw-warn)' : 'var(--qw-ok)'} />
    </div>
  )
}

/** Run-level Explain roll-up across every turn report under the run. */
export function RunInsightFacts({ reports }: { reports: readonly TurnDecisionReport[] }) {
  if (reports.length === 0) return null
  return (
    <Section title="Run insight">
      <RunInsightBody agg={aggregateRun(reports)} />
    </Section>
  )
}
