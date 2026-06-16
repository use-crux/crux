/**
 * Overview — "where do I stand?"
 *
 * A KPI strip (pass rate, mean score ±SEM, cost, latency, experiment counts)
 * over a two-column body: a failing-first attention feed (derived insights) on
 * the left; recent experiments and a derived activity feed on the right.
 * Everything is hydrated from /api/quality/* via TanStack Query.
 */

import * as React from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip, Kpi, Sparkline } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import {
  QEmpty,
  ReplayBadge,
  ScoreStat,
  TaskGlyph,
  shortId,
  taskKindFromId,
  timeAgo,
} from '@/qw/shell/qualityKit'
import { SkeletonKpiStrip, SkeletonRows } from '@/shared/components/Skeleton'
import {
  useQualityOverview,
  useQualityInsights,
  useQualityExperiments,
  useQualityBaselines,
  useQualityFeedback,
} from '@/shared/hooks/useQualityApi'
import { navTarget } from '@/app/navigation/navTarget'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import type { QualityExperimentSummary } from '@/types'

const SEV_TONE = { high: 'danger', medium: 'warn', low: 'iris' } as const
const SEV_RANK = { high: 0, medium: 1, low: 2 } as const

function sevColor(s: 'high' | 'medium' | 'low'): string {
  return s === 'high' ? 'var(--qw-danger)' : s === 'medium' ? 'var(--qw-warn)' : 'var(--qw-iris)'
}

function expVerdict(e: QualityExperimentSummary): 'passed' | 'failed' | 'informational' {
  if (e.gatesInformational || e.filteredRun) return 'informational'
  return e.passed ? 'passed' : 'failed'
}

interface ActivityItem {
  who: string
  what: string
  target: string
  when: string
  ts: number
  tone: 'ok' | 'danger' | 'iris' | 'crux'
}

export function OverviewView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const { data: overview, loading } = useQualityOverview()
  const { data: insights } = useQualityInsights()
  const { data: experiments } = useQualityExperiments()
  const { data: baselines } = useQualityBaselines()
  const { data: feedback } = useQualityFeedback()

  const openInsights = React.useMemo(
    () =>
      (insights ?? [])
        .filter((i) => i.status === 'open')
        .slice()
        .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])
        .slice(0, 5),
    [insights],
  )

  const recentExperiments = React.useMemo(
    () =>
      (experiments ?? [])
        .slice()
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, 5),
    [experiments],
  )

  const activity = React.useMemo<ActivityItem[]>(() => {
    const items: ActivityItem[] = []
    for (const b of baselines ?? []) {
      items.push({
        who: b.promotedBy ?? 'someone',
        what: 'promoted',
        target: `${shortId(b.experimentId)} → ${b.evaluationId}`,
        when: timeAgo(b.promotedAt),
        ts: Date.parse(b.promotedAt) || 0,
        tone: 'ok',
      })
    }
    for (const e of experiments ?? []) {
      const v = expVerdict(e)
      items.push({
        who: 'cli',
        what: 'experiment completed',
        target: `${shortId(e.experimentId)} · ${v}`,
        when: timeAgo(e.endedAt || e.startedAt),
        ts: Date.parse(e.endedAt || e.startedAt) || 0,
        tone: v === 'passed' ? 'ok' : v === 'failed' ? 'danger' : 'crux',
      })
    }
    for (const f of feedback ?? []) {
      if (!f.traceId) continue
      items.push({
        who: 'feedback',
        what: 'left on',
        target: shortId(f.traceId),
        when: timeAgo(f.createdAt),
        ts: Date.parse(f.createdAt) || 0,
        tone: 'iris',
      })
    }
    return items.sort((a, b) => b.ts - a.ts).slice(0, 6)
  }, [baselines, experiments, feedback])

  const o = overview
  const sevCounts = o?.openInsightSeverityCounts ?? {}

  return (
    <QwShell
      activeView="overview"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Quality / Overview"
      title="Quality at a glance"
      subtitle="Last window · this workbench"
      connected={connected}
      actions={
        <Btn icon={<Icon name="trace" size={13} />} onClick={() => navigate({ view: 'runs' })}>
          Open runs
        </Btn>
      }
    >
      <div className="px-8 pb-10 pt-6">
        {loading && !o ? (
          <SkeletonKpiStrip count={5} />
        ) : (
          <div className="mb-[22px] grid grid-cols-5 gap-3">
            <Kpi
              label="Pass rate"
              value={o?.passRate != null ? `${Math.round(o.passRate * 100)}%` : '—'}
              trend={o?.passRateSpark}
              sublabel="last window"
            />
            <div
              className="flex min-w-0 flex-col gap-2 rounded-[10px] px-4 py-3.5"
              style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
            >
              <span className="text-[11px] font-medium uppercase tracking-[0.04em]" style={{ color: 'var(--qw-fg-muted)' }}>
                Mean score
              </span>
              <ScoreStat value={o?.meanScore ?? null} sem={0.04} width={120} />
            </div>
            <Kpi
              label="Cost · window"
              value={o ? `$${o.totalCost.toFixed(2)}` : '—'}
              trend={o?.costSpark}
              sublabel={o?.costPer100Runs != null ? `$${o.costPer100Runs.toFixed(2)} / 100 runs` : undefined}
            />
            <Kpi
              label="P50 latency"
              value={o?.p50LatencyMs != null ? `${(o.p50LatencyMs / 1000).toFixed(1)}s` : '—'}
              trend={o?.latencySpark}
              sublabel={o?.p95LatencyMs != null ? `P95 ${(o.p95LatencyMs / 1000).toFixed(1)}s` : undefined}
            />
            <Kpi
              label="Experiments"
              value={o ? String(o.experimentCount) : '—'}
              sublabel={o ? `${o.baselineCount} baselines · ${o.staleCassetteCount} stale cassettes` : undefined}
            />
          </div>
        )}

        <div className="grid gap-[18px]" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
          {/* attention feed */}
          <div className="overflow-hidden rounded-[12px]" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
            <div className="flex items-center gap-2.5 px-[18px] py-3" style={{ borderBottom: '1px solid var(--qw-border)' }}>
              <Icon name="sparkle" size={14} color="var(--qw-crux)" />
              <span className="text-[13px] font-semibold">Needs attention</span>
              {(sevCounts.high ?? 0) > 0 && (
                <Chip tone="danger" mono>
                  {sevCounts.high} high
                </Chip>
              )}
              {(sevCounts.medium ?? 0) > 0 && (
                <Chip tone="warn" mono>
                  {sevCounts.medium} med
                </Chip>
              )}
              <span className="ml-auto font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                failing first
              </span>
            </div>
            {openInsights.length === 0 ? (
              <div className="px-[18px] py-8 text-center text-[12.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                Nothing needs attention — no open insights.
              </div>
            ) : (
              openInsights.map((ins, i) => (
                <button
                  key={ins.insightId}
                  onClick={() => navigate({ view: 'insights' })}
                  className="grid w-full items-center gap-3.5 px-[18px] py-3 text-left"
                  style={{
                    gridTemplateColumns: '1fr 96px',
                    borderBottom: i === openInsights.length - 1 ? 'none' : '1px solid var(--qw-border)',
                    borderLeft: `3px solid ${sevColor(ins.severity)}`,
                  }}
                >
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-medium leading-[1.35]">{ins.title}</div>
                    <div className="mt-1.5 flex items-center gap-[7px]">
                      <Chip tone={SEV_TONE[ins.severity]} dot>
                        {ins.severity}
                      </Chip>
                      {ins.targetId && (
                        <span className="truncate font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                          {ins.targetId}
                        </span>
                      )}
                    </div>
                  </div>
                  {ins.trend.length > 1 && (
                    <Sparkline data={ins.trend} width={88} height={26} color={sevColor(ins.severity)} fill={false} />
                  )}
                </button>
              ))
            )}
          </div>

          {/* recent experiments + activity */}
          <div className="flex flex-col gap-[18px]">
            <div className="overflow-hidden rounded-[12px]" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
              <div className="flex items-center gap-2.5 px-[18px] py-3" style={{ borderBottom: '1px solid var(--qw-border)' }}>
                <Icon name="flask" size={14} color="var(--qw-crux)" />
                <span className="text-[13px] font-semibold">Recent experiments</span>
              </div>
              {loading && recentExperiments.length === 0 ? (
                <div className="px-4 py-4">
                  <SkeletonRows rows={4} rowHeight={32} />
                </div>
              ) : recentExperiments.length === 0 ? (
                <div className="px-[18px] py-6 text-center text-[12.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  No experiments yet.
                </div>
              ) : (
                recentExperiments.map((r, i) => {
                  const v = expVerdict(r)
                  const vt = v === 'passed' ? 'var(--qw-ok)' : v === 'failed' ? 'var(--qw-danger)' : 'var(--qw-fg-muted)'
                  return (
                    <button
                      key={r.experimentId}
                      onClick={() => navigate({ view: 'experiment-detail', experimentId: r.experimentId })}
                      className="flex w-full items-center gap-2.5 px-[18px] py-2.5 text-left"
                      style={{ borderBottom: i === recentExperiments.length - 1 ? 'none' : '1px solid var(--qw-border)' }}
                    >
                      <span className="size-2 shrink-0 rounded-full" style={{ background: vt }} />
                      <TaskGlyph kind={taskKindFromId(r.evaluationId)} size={20} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-[11px]">{r.evaluationId}</div>
                        <div className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
                          {shortId(r.experimentId)}
                        </div>
                      </div>
                      <ReplayBadge mode={r.replayMode} />
                      <span className="w-9 text-right font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                        {timeAgo(r.startedAt)}
                      </span>
                    </button>
                  )
                })
              )}
            </div>

            <div className="overflow-hidden rounded-[12px]" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
              <div className="flex items-center gap-2.5 px-[18px] py-3" style={{ borderBottom: '1px solid var(--qw-border)' }}>
                <Icon name="loop" size={14} color="var(--qw-fg-muted)" />
                <span className="text-[13px] font-semibold">Activity</span>
              </div>
              <div className="py-1.5">
                {activity.length === 0 ? (
                  <div className="px-[18px] py-4 text-center text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
                    No recent activity.
                  </div>
                ) : (
                  activity.map((a, i) => (
                    <div key={i} className="grid items-start gap-2.5 px-[18px] py-2 text-[12.5px]" style={{ gridTemplateColumns: '20px 1fr 42px' }}>
                      <span
                        className="mt-1.5 size-[7px] rounded-full"
                        style={{ background: a.tone === 'danger' ? 'var(--qw-danger)' : a.tone === 'ok' ? 'var(--qw-ok)' : a.tone === 'iris' ? 'var(--qw-iris)' : 'var(--qw-crux)' }}
                      />
                      <div className="min-w-0">
                        <span className="font-medium">{a.who}</span>
                        <span style={{ color: 'var(--qw-fg-muted)' }}> {a.what} </span>
                        <span className="font-mono text-[11px]">{a.target}</span>
                      </div>
                      <span className="text-right font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                        {a.when}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {!loading && !o && (insights ?? []).length === 0 && (experiments ?? []).length === 0 && (
          <div className="mt-6">
            <QEmpty
              icon="home"
              title="Nothing here yet"
              body="Once you run an evaluation, its experiments, insights and KPIs land here."
            />
          </div>
        )}
      </div>
    </QwShell>
  )
}
