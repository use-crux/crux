/**
 * Overview screen — "what needs attention?"
 *
 * KPIs across the top, then a two-column layout: open insights digest + recent
 * runs on the left, active experiments + activity feed on the right.
 * Data is hydrated from /api/quality/overview and falls back to local runtime
 * counts when the BFF hasn't returned yet.
 */

import { useMemo } from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip, Kpi, SectionHead, Sparkline, type ChipTone } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonRows, SkeletonText, SkeletonKpiStrip } from '@/shared/components/Skeleton'
import { usePrefetchRunDetail } from '@/shared/hooks/usePrefetch'
import {
  useQualityOverview,
  useQualityInsights,
  useQualityExperiments,
  useQualityBaselines,
  useQualityFeedback,
} from '@/shared/hooks/useQualityApi'
import { useToast } from '@/qw/shell/useToast'
import { navTarget } from '@/app/navigation/navTarget'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useObservabilityRuns } from '@/features/observability/hooks/useObservabilityGraph'
import { useConnected } from '@/app/runtime/runtimeStore'
import type { ObservabilityRunSummary, QualityInsightRecord, QualityRunRecord } from '@/types'

function formatCost(n: number | undefined): string {
  if (n == null) return '—'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

function formatPct(n: number | undefined): string {
  if (n == null) return '—'
  return `${(n * 100).toFixed(1)}%`
}

function formatScore(n: number | undefined): string {
  if (n == null) return '—'
  return n.toFixed(2)
}

function formatLatency(ms: number | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function timeAgo(ts: number | undefined): string {
  if (!ts) return '—'
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const SEV_TONE: Record<'high' | 'medium' | 'low', ChipTone> = {
  high: 'danger',
  medium: 'warn',
  low: 'iris',
}

function statusTone(status: string): ChipTone {
  if (status === 'success' || status === 'ok') return 'ok'
  if (status === 'running') return 'crux'
  if (status === 'error' || status === 'fail') return 'danger'
  return 'warn'
}

function metricNumber(metrics: Record<string, unknown> | null | undefined, key: string): number | undefined {
  const value = metrics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function fallbackRecentRuns(runs: readonly ObservabilityRunSummary[]): QualityRunRecord[] {
  return runs
    .slice()
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, 6)
    .map(
      (run) =>
        ({
          _tag: 'QualityRun',
          traceId: run.runId,
          targetId: run.promptId || run.name || run.rootPrimitive || run.runId,
          status: run.status,
          startedAt: Date.parse(run.startedAt) || 0,
          durationMs: run.durationMs,
          model: run.model,
          provider: run.provider,
          cost: metricNumber(run.metrics, 'costUsd') ?? metricNumber(run.metrics, 'cost'),
          toolCallCount: 0,
          feedbackIds: [],
          experimentIds: [],
        }) satisfies QualityRunRecord,
    )
}

export function OverviewView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const { toast } = useToast()
  const prefetchRun = usePrefetchRunDetail()
  const { data: overview, loading: overviewLoading } = useQualityOverview()
  const { data: insights, loading: insightsLoading } = useQualityInsights()
  const { data: experimentsData, loading: experimentsLoading } = useQualityExperiments()
  // Warm caches for ActivityFeed (mounted below) so its first paint is
  // a cache hit even when the activity card is below the fold.
  useQualityBaselines()
  useQualityFeedback()
  const experiments = experimentsData ?? []
  const canonicalRuns = useObservabilityRuns()

  // "Initial load" = no data yet AND still pending. Once any data has
  // arrived we never go back to a skeleton (subsequent background
  // refetches keep the previous values on screen, no flicker).
  const overviewInitialLoading = overviewLoading && !overview
  const insightsInitialLoading = insightsLoading && !insights
  const experimentsInitialLoading = experimentsLoading && !experimentsData

  const runs = overview?.recentRuns?.length
    ? overview.recentRuns
    : fallbackRecentRuns(canonicalRuns.runs)

  const runCount = overview?.runCount ?? canonicalRuns.runs.length
  const liveCount = canonicalRuns.runs.filter((run) => run.status === 'running').length

  const totalCost =
    overview?.totalCost ??
    canonicalRuns.runs.reduce((sum, run) => sum + (metricNumber(run.metrics, 'costUsd') ?? metricNumber(run.metrics, 'cost') ?? 0), 0)

  const openInsights = (insights ?? []).filter((i) => i.status === 'open')
  const sev = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 }
    for (const i of openInsights) counts[i.severity]++
    return counts
  }, [openInsights])

  return (
    <QwShell
      activeView="overview"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Quality / Overview"
      title="Quality at a glance"
      subtitle="Live · last 24h"
      connected={connected}
      port={4400}
      appLabel="@crux/devtools"
      actions={
        <>
          <Btn
            icon={<Icon name="filter" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Time window',
                message: 'Window picker UI is next. Use ⌘K search to jump to any run.',
              })
            }
          >
            24h
          </Btn>
          <Btn
            variant="primary"
            icon={<Icon name="play" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Trigger a run',
                message: 'Runs are captured automatically when your app calls generate()/stream().',
              })
            }
          >
            New run
          </Btn>
        </>
      }
    >
      <div className="px-8 pb-10 pt-6">
        {/* KPI strip */}
        <SectionBoundary title="KPIs" fallback={<SkeletonKpiStrip count={5} />}>
          {overviewInitialLoading ? (
            <div className="mb-6">
              <SkeletonKpiStrip count={5} />
            </div>
          ) : (
            <div className="mb-6 grid grid-cols-5 gap-3">
              <Kpi
                label="Runs"
                value={runCount.toLocaleString()}
                sublabel={liveCount > 0 ? `${liveCount} live now` : 'none live'}
                trend={overview?.openInsightsHistory?.length ? overview.openInsightsHistory : undefined}
              />
              <Kpi
                label="Pass rate"
                value={formatPct(overview?.passRate)}
                sublabel={overview?.latestExperimentId ? `latest · ${overview.latestExperimentId}` : 'across all suites'}
                trend={overview?.passRateSpark?.length ? overview.passRateSpark : undefined}
              />
              <Kpi label="Mean score" value={formatScore(overview?.meanScore)} sublabel="all scorers" />
              <Kpi
                label="Cost · 24h"
                value={formatCost(totalCost)}
                sublabel={runCount > 0 ? `${formatCost(totalCost / runCount)} / run` : '—'}
                trend={overview?.costSpark?.length ? overview.costSpark : undefined}
              />
              <Kpi
                label="P50 latency"
                value={formatLatency(overview?.p50LatencyMs)}
                sublabel="end-to-end"
                trend={overview?.latencySpark?.length ? overview.latencySpark : undefined}
              />
            </div>
          )}
        </SectionBoundary>

        <div className="grid grid-cols-[1.4fr_1fr] gap-[18px]">
          {/* Left column */}
          <div className="flex flex-col gap-[18px]">
            <SectionBoundary title="Open insights" fallback={<InsightsSkeleton />}>
              {insightsInitialLoading ? (
                <InsightsSkeleton />
              ) : (
            <Card>
              <CardHead>
                <Icon name="sparkle" size={14} color="var(--qw-crux)" />
                <span className="text-[13px] font-semibold">Open insights</span>
                {sev.high > 0 && (
                  <Chip tone="danger" mono>
                    {sev.high} high
                  </Chip>
                )}
                {sev.medium > 0 && (
                  <Chip tone="warn" mono>
                    {sev.medium} medium
                  </Chip>
                )}
                {sev.low > 0 && (
                  <Chip tone="iris" mono>
                    {sev.low} low
                  </Chip>
                )}
                <span
                  className="ml-auto font-mono text-[11px]"
                  style={{ color: 'var(--qw-fg-faint)' }}
                >
                  {openInsights.length} open
                </span>
              </CardHead>
              {openInsights.length === 0 && (
                <div className="px-[18px] py-6 text-center text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  No open insights. Capture some traces or run an experiment to populate diagnoses.
                </div>
              )}
              {openInsights.slice(0, 4).map((ins, i, arr) => (
                <InsightDigestRow key={ins.insightId} ins={ins} last={i === arr.length - 1} />
              ))}
              {openInsights.length > 0 && (
                <div className="flex justify-end px-[18px] py-2.5">
                  <Btn
                    size="xs"
                    iconRight={<Icon name="arrowRight" size={12} />}
                    onClick={() => navigate({ view: 'insights' })}
                  >
                    Open all {openInsights.length} insights
                  </Btn>
                </div>
              )}
            </Card>
              )}
            </SectionBoundary>

            <SectionBoundary title="Recent runs" fallback={<CardSkeleton rows={6} />}>
            <Card>
              <CardHead>
                <Icon name="trace" size={14} color="var(--qw-fg-muted)" />
                <span className="text-[13px] font-semibold">Recent runs</span>
                <span
                  className="ml-auto font-mono text-[11px]"
                  style={{ color: 'var(--qw-fg-faint)' }}
                >
                  live
                </span>
              </CardHead>
              {runs.length === 0 && (
                <div className="px-[18px] py-6 text-center text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  Waiting for traces. Call <code className="font-mono">enableDevtools()</code> to start.
                </div>
              )}
              {runs.slice(0, 6).map((r, i, arr) => (
                <button
                  key={r.traceId}
                  onClick={() => navigate({ view: 'run-detail', traceId: r.traceId })}
                  onMouseEnter={() => prefetchRun(r.traceId)}
                  onFocus={() => prefetchRun(r.traceId)}
                  className="grid grid-cols-[70px_90px_1fr_60px_70px_50px] items-center gap-2.5 px-[18px] py-2 text-left text-[12px] transition-colors hover:opacity-90"
                  style={{ borderBottom: i === arr.length - 1 ? 'none' : '1px solid var(--qw-border)' }}
                >
                  <Chip tone={statusTone(r.status)} dot>
                    {r.status}
                  </Chip>
                  <span className="truncate font-mono text-[11.5px]" style={{ color: 'var(--qw-crux)' }}>
                    {r.traceId.slice(0, 8)}
                  </span>
                  <span className="truncate font-mono text-[11.5px]">{r.targetId ?? '—'}</span>
                  <span
                    className="text-right font-mono text-[11.5px]"
                    style={{ color: 'var(--qw-fg-muted)' }}
                  >
                    {formatLatency(r.durationMs)}
                  </span>
                  <span className="text-right font-mono text-[11.5px]">
                    {r.score != null ? r.score.toFixed(2) : '—'}
                  </span>
                  <span
                    className="text-right font-mono text-[11px]"
                    style={{ color: 'var(--qw-fg-faint)' }}
                  >
                    {timeAgo(r.startedAt)}
                  </span>
                </button>
              ))}
            </Card>
            </SectionBoundary>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-[18px]">
            <SectionBoundary title="Recent experiments" fallback={<CardSkeleton rows={4} />}>
              {experimentsInitialLoading ? (
                <CardSkeleton rows={4} />
              ) : (
            <Card>
              <CardHead>
                <Icon name="flask" size={14} color="var(--qw-crux)" />
                <span className="text-[13px] font-semibold">Recent experiments</span>
                {experiments.length > 0 && (
                  <Chip tone="crux" mono>
                    {experiments.length} total
                  </Chip>
                )}
              </CardHead>
              {experiments.length === 0 && (
                <div className="px-[18px] py-6 text-center text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  No experiments yet. Promote a baseline or start a new one.
                </div>
              )}
              {experiments.slice(0, 4).map((e, i, arr) => {
                const passRate = e.summary.total > 0 ? e.summary.passed / e.summary.total : undefined
                return (
                  <button
                    key={e.id}
                    onClick={() => navigate({ view: 'experiment-detail', experimentId: e.id })}
                    className="block w-full px-[18px] py-3 text-left transition-colors hover:opacity-90"
                    style={{ borderBottom: i === arr.length - 1 ? 'none' : '1px solid var(--qw-border)' }}
                  >
                    <div className="mb-1.5 flex items-center gap-2">
                      <Chip
                        tone={e.status === 'passed' ? 'ok' : e.status === 'failed' ? 'danger' : 'muted'}
                      >
                        {e.status}
                      </Chip>
                      <span className="font-mono text-[11px]" style={{ color: 'var(--qw-crux)' }}>
                        {e.id}
                      </span>
                      <span
                        className="ml-auto font-mono text-[10.5px]"
                        style={{ color: 'var(--qw-fg-faint)' }}
                      >
                        {timeAgo(e.startedAt ? Date.parse(e.startedAt) : undefined)}
                      </span>
                    </div>
                    <div className="text-[12.5px] font-medium">{e.suite.name ?? e.suite.id}</div>
                    <div
                      className="mt-1.5 flex gap-3.5 font-mono text-[10.5px]"
                      style={{ color: 'var(--qw-fg-muted)' }}
                    >
                      <span>{e.summary.passed}/{e.summary.total} passed</span>
                      {passRate != null && <span>{formatPct(passRate)} pass</span>}
                      <span>{e.variants.length} variant{e.variants.length === 1 ? '' : 's'}</span>
                    </div>
                  </button>
                )
              })}
            </Card>
              )}
            </SectionBoundary>

            <SectionBoundary title="Recent activity" fallback={<CardSkeleton rows={3} />}>
              <Card>
                <CardHead>
                  <Icon name="loop" size={14} color="var(--qw-fg-muted)" />
                  <span className="text-[13px] font-semibold">Recent activity</span>
                </CardHead>
                <ActivityFeed />
              </Card>
            </SectionBoundary>
          </div>
        </div>
      </div>
    </QwShell>
  )
}

// ─── Loading skeletons ──────────────────────────────────────────────

function CardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <div
        className="flex items-center gap-2.5 px-[18px] py-3"
        style={{ borderBottom: '1px solid var(--qw-border)' }}
      >
        <SkeletonText lines={1} lineHeight={12} width="32%" />
      </div>
      <div className="px-[18px] py-3">
        <SkeletonRows rows={rows} rowHeight={32} />
      </div>
    </div>
  )
}

function InsightsSkeleton() {
  return <CardSkeleton rows={4} />
}

// ─── Sub-components ─────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      {children}
    </div>
  )
}

function CardHead({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2.5 px-[18px] py-3"
      style={{ borderBottom: '1px solid var(--qw-border)' }}
    >
      {children}
    </div>
  )
}

function InsightDigestRow({ ins, last }: { ins: QualityInsightRecord; last: boolean }) {
  const { navigate } = useNavigation()
  const stripe =
    ins.severity === 'high' ? 'var(--qw-danger)' : ins.severity === 'medium' ? 'var(--qw-warn)' : 'var(--qw-iris)'
  return (
    <button
      onClick={() => navigate({ view: 'insights', insightId: ins.insightId })}
      className="grid w-full grid-cols-[4px_1fr_90px_80px] items-center gap-3.5 px-[18px] py-3 text-left transition-colors hover:opacity-90"
      style={{ borderBottom: last ? 'none' : '1px solid var(--qw-border)' }}
    >
      <span className="h-7 w-1 rounded-full" style={{ background: stripe }} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium">{ins.title}</div>
        <div className="mt-1 flex items-center gap-1.5">
          <Chip tone={SEV_TONE[ins.severity]} dot>
            {ins.severity}
          </Chip>
          {ins.targetId && (
            <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
              target · {ins.targetId}
            </span>
          )}
          {ins.updatedAt && (
            <span className="text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
              · {timeAgo(Date.parse(ins.updatedAt))}
            </span>
          )}
        </div>
      </div>
      <div className="flex justify-center">
        <Sparkline data={[1, 2, 1, 3, 4, 6, 5, 7, 6, 8]} width={80} height={22} />
      </div>
      <div className="text-right">
        <span className="font-mono text-[12px] font-semibold">{ins.linkedTraceIds?.length ?? 0}</span>
        <div className="text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
          traces
        </div>
      </div>
    </button>
  )
}

function ActivityFeed() {
  const { data: experimentsData } = useQualityExperiments()
  const { data: baselinesData } = useQualityBaselines()
  const { data: feedbackData } = useQualityFeedback()
  const experiments = experimentsData ?? []
  const baselines = baselinesData ?? []
  const feedback = feedbackData ?? []
  const items = useMemo(() => {
    const out: { tone: ChipTone; when: number; line: React.ReactNode }[] = []
    for (const e of experiments.slice(0, 3)) {
      out.push({
        tone: 'iris',
        when: e.startedAt ? Date.parse(e.startedAt) : Date.now(),
        line: (
          <>
            <span className="font-medium">experiment</span>{' '}
            <span style={{ color: 'var(--qw-fg-muted)' }}>started</span>{' '}
            <span className="font-mono text-[11.5px]">{e.id}</span>
          </>
        ),
      })
    }
    for (const b of baselines.slice(0, 2)) {
      out.push({
        tone: 'ok',
        when: b.promotedAt ? Date.parse(b.promotedAt) : Date.now(),
        line: (
          <>
            <span className="font-medium">baseline</span>{' '}
            <span style={{ color: 'var(--qw-fg-muted)' }}>promoted</span>{' '}
            <span className="font-mono text-[11.5px]">{b.experimentId} → baseline</span>
          </>
        ),
      })
    }
    for (const f of feedback.slice(0, 2)) {
      out.push({
        tone: 'crux',
        when: f.createdAt ? Date.parse(f.createdAt) : Date.now(),
        line: (
          <>
            <span className="font-medium">feedback</span>{' '}
            <span style={{ color: 'var(--qw-fg-muted)' }}>logged on</span>{' '}
            <span className="font-mono text-[11.5px]">trace {f.traceId?.slice(0, 8) ?? '—'}</span>
          </>
        ),
      })
    }
    out.sort((a, b) => b.when - a.when)
    return out.slice(0, 5)
  }, [experiments, baselines, feedback])

  if (items.length === 0) {
    return (
      <div className="px-[18px] py-6 text-center text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
        Activity will appear here as experiments run, baselines promote, and feedback lands.
      </div>
    )
  }

  return (
    <div className="py-1.5">
      {items.map((a, i) => {
        const dot =
          a.tone === 'danger'
            ? 'var(--qw-danger)'
            : a.tone === 'ok'
              ? 'var(--qw-ok)'
              : a.tone === 'iris'
                ? 'var(--qw-iris)'
                : 'var(--qw-crux)'
        return (
          <div
            key={i}
            className="grid grid-cols-[22px_1fr_60px] items-start gap-2.5 px-[18px] py-2 text-[12px]"
          >
            <div className="flex justify-center pt-1.5">
              <span className="size-1.5 rounded-full" style={{ background: dot }} />
            </div>
            <div>{a.line}</div>
            <span
              className="text-right font-mono text-[11px]"
              style={{ color: 'var(--qw-fg-faint)' }}
            >
              {timeAgo(a.when)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

