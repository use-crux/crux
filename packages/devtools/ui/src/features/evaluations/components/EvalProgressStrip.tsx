/**
 * Evaluation progress — the OUTER loop. "Is this evaluation improving,
 * regressing, or flaky over time?" — the question the global Experiments feed
 * can't answer.
 *
 * Bound to the backend projection `QualityEvaluationProgress`
 * (`GET /api/quality/evaluations/{id}/progress`). A trajectory of recent runs
 * (oldest → newest): the selected metric per run as a point with ±SEM whiskers,
 * the promoted baseline as a dashed reference line, points coloured by gate
 * outcome. A metric selector toggles pass rate · each score · cost; the
 * headline shows the latest value and its delta vs baseline; clicking a point
 * reveals that run's detail. Degrades to "not enough runs yet" under 2 runs.
 */

import * as React from 'react'
import { SectionHead } from '@/qw/shell/primitives'
import { Chip, Btn } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { fmtCost, fmtPct, timeAgo } from '@/qw/shell/qualityKit'
import { useQualityEvaluationProgress } from '@/shared/hooks/useQualityApi'
import { useNavigation } from '@/app/navigation/useNavigation'
import type { QualityEvaluationProgress, QualityEvaluationProgressRun } from '@/types'

interface MetricDef {
  key: string
  label: string
  fmt: (v: number) => string
  clamp: [number, number] | null
  baseline: number | null
  /** Resolve a run to its value, sem, and gate outcome for this metric. */
  point: (run: QualityEvaluationProgressRun) => { v: number | null; sem: number; ok: boolean | null }
}

function verdictOk(run: QualityEvaluationProgressRun): boolean | null {
  if (run.verdict === 'passed') return true
  if (run.verdict === 'failed' || run.verdict === 'errored') return false
  return null
}

export function EvalProgressStrip({ evaluationId }: { evaluationId: string }) {
  const { navigate } = useNavigation()
  const { data: progress, loading } = useQualityEvaluationProgress(evaluationId, 12)
  const [metric, setMetric] = React.useState<string | null>(null)
  const [sel, setSel] = React.useState<string | null>(null)

  // Reset the selected point when the evaluation changes.
  React.useEffect(() => {
    setSel(null)
    setMetric(null)
  }, [evaluationId])

  if (loading && !progress) {
    return (
      <div className="mb-6">
        <SectionHead eyebrow="Progress over time" />
        <div className="rounded-[12px] px-5 py-6 text-center text-[12.5px]" style={{ border: '1px solid var(--qw-border)', color: 'var(--qw-fg-faint)' }}>
          loading trajectory…
        </div>
      </div>
    )
  }

  if (!progress || progress.runs.length < 2) {
    return (
      <div className="mb-6">
        <SectionHead eyebrow="Progress over time" />
        <div
          className="rounded-[10px] px-5 py-6 text-center text-[12.5px]"
          style={{ border: '1px dashed var(--qw-border)', color: 'var(--qw-fg-muted)' }}
        >
          <Icon name="spark" size={18} color="var(--qw-fg-faint)" />
          <div className="mt-2">Not enough runs yet to chart a trend. Run this evaluation a few times and its trajectory shows here.</div>
        </div>
      </div>
    )
  }

  return <ProgressChart progress={progress} metric={metric} setMetric={setMetric} sel={sel} setSel={setSel} onOpen={(id) => navigate({ view: 'experiment-detail', experimentId: id })} />
}

function ProgressChart({
  progress,
  metric,
  setMetric,
  sel,
  setSel,
  onOpen,
}: {
  progress: QualityEvaluationProgress
  metric: string | null
  setMetric: (m: string) => void
  sel: string | null
  setSel: (id: string | null) => void
  onOpen: (experimentId: string) => void
}) {
  // Oldest → newest for a left-to-right trajectory (backend sorts newest-first).
  const orderedRuns = React.useMemo(() => [...progress.runs].reverse(), [progress.runs])

  const metrics: MetricDef[] = React.useMemo(() => {
    const scoreMetrics: MetricDef[] = progress.scoreSeries.map((series) => {
      const byExp = new Map(series.points.map((p) => [p.experimentId, p]))
      return {
        key: `score:${series.scoreName}`,
        label: series.scoreName,
        fmt: (v: number) => v.toFixed(2),
        clamp: [0, 1] as [number, number],
        baseline: series.baseline?.value ?? null,
        point: (run) => {
          const p = byExp.get(run.experimentId)
          return { v: p ? p.mean : null, sem: p?.sem ?? 0, ok: p?.passedGate ?? verdictOk(run) }
        },
      }
    })
    return [
      {
        key: 'passRate',
        label: 'pass rate',
        fmt: (v: number) => fmtPct(v),
        clamp: [0, 1],
        baseline: null,
        point: (run) => ({ v: run.passRate, sem: 0, ok: verdictOk(run) }),
      },
      ...scoreMetrics,
      {
        key: 'cost',
        label: 'cost',
        fmt: (v: number) => fmtCost(v),
        clamp: null,
        baseline: null,
        point: (run) => ({ v: run.costUsd ?? null, sem: 0, ok: verdictOk(run) }),
      },
    ]
  }, [progress.scoreSeries])

  // Only offer metrics that actually have ≥2 chartable points for this
  // evaluation. A cost-free eval (local/replayed runs record no per-run cost)
  // shouldn't show a 'cost' toggle that dead-ends on "not enough data points".
  // Pass rate is always present, so the selector is never empty.
  const available = React.useMemo(
    () => metrics.filter((m) => orderedRuns.filter((r) => m.point(r).v != null).length >= 2),
    [metrics, orderedRuns],
  )

  const M =
    available.find((m) => m.key === metric) ?? available.find((m) => m.key.startsWith('score:')) ?? available[0]

  if (!M) {
    return (
      <div className="mb-6">
        <SectionHead eyebrow="Progress over time" />
        <div
          className="rounded-[10px] px-5 py-6 text-center text-[12.5px]"
          style={{ border: '1px dashed var(--qw-border)', color: 'var(--qw-fg-muted)' }}
        >
          Not enough data points to chart a trend yet.
        </div>
      </div>
    )
  }

  // Series
  const pts = orderedRuns
    .map((run) => {
      const g = M.point(run)
      return g.v == null ? null : { run, v: g.v, sem: g.sem, ok: g.ok }
    })
    .filter((p): p is { run: QualityEvaluationProgressRun; v: number; sem: number; ok: boolean | null } => p != null)

  if (pts.length < 2) {
    return (
      <div className="mb-6">
        <SectionHead eyebrow="Progress over time" />
        <div className="rounded-[10px] px-5 py-6 text-center text-[12.5px]" style={{ border: '1px dashed var(--qw-border)', color: 'var(--qw-fg-muted)' }}>
          Not enough data points for {M.label} yet.
        </div>
      </div>
    )
  }

  const vals = pts.map((p) => p.v)
  const baseV = M.baseline
  let lo = Math.min(...vals, baseV ?? Infinity)
  let hi = Math.max(...vals, baseV ?? -Infinity)
  const pad = (hi - lo) * 0.25 || 0.05
  lo -= pad
  hi += pad
  if (M.clamp) {
    lo = Math.max(M.clamp[0], lo)
    hi = Math.min(M.clamp[1], hi)
  }
  if (hi - lo < 1e-6) hi = lo + 1

  const W = 720
  const H = 188
  const padL = 8
  const padR = 12
  const padT = 16
  const padB = 26
  const plotW = W - padL - padR
  const plotH = H - padT - padB
  const x = (i: number) => padL + (i / (pts.length - 1)) * plotW
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * plotH

  const linePath = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
  const latest = pts[pts.length - 1]
  const trendUp = latest.v >= pts[0].v
  const selPt = sel != null ? pts.find((p) => p.run.experimentId === sel) : null

  const ptColor = (ok: boolean | null) =>
    ok === false ? 'var(--qw-danger)' : ok === true ? 'var(--qw-ok)' : 'var(--qw-fg-muted)'

  return (
    <div className="mb-6">
      <SectionHead
        eyebrow={`Progress over time · last ${pts.length} runs`}
        right={
          <div className="flex flex-wrap gap-1 rounded-[7px] p-0.5" style={{ background: 'var(--qw-bg-muted)' }}>
            {available.map((m) => {
              const on = m.key === M.key
              return (
                <button
                  key={m.key}
                  onClick={() => setMetric(m.key)}
                  className="rounded-[5px] px-2.5 py-1 font-mono text-[11px] font-semibold"
                  style={{
                    background: on ? 'var(--qw-bg-elev)' : 'transparent',
                    color: on ? 'var(--qw-fg)' : 'var(--qw-fg-muted)',
                    boxShadow: on ? 'inset 0 0 0 1px var(--qw-border)' : 'none',
                  }}
                >
                  {m.label}
                </button>
              )
            })}
          </div>
        }
      />

      <div className="rounded-[12px] px-[18px] py-4" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
        <div className="mb-1.5 flex items-baseline gap-2.5">
          <span className="font-mono text-[22px] font-semibold">{M.fmt(latest.v)}</span>
          {M.baseline != null && (
            <span
              className="inline-flex items-center gap-1 font-mono text-[12px] font-semibold"
              style={{ color: latest.v >= M.baseline ? 'var(--qw-ok)' : 'var(--qw-danger)' }}
            >
              <Icon name={latest.v >= M.baseline ? 'arrowUp' : 'arrowDown'} size={11} color={latest.v >= M.baseline ? 'var(--qw-ok)' : 'var(--qw-danger)'} strokeWidth={2.4} />
              {(latest.v - M.baseline >= 0 ? '+' : '') + (latest.v - M.baseline).toFixed(2)} vs baseline
            </span>
          )}
          <span className="ml-auto font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            latest · {timeAgo(latest.run.finishedAt ?? latest.run.startedAt)}
          </span>
        </div>

        <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="block overflow-visible">
          {/* baseline reference line */}
          {M.baseline != null && (
            <g>
              <line x1={padL} y1={y(M.baseline)} x2={W - padR} y2={y(M.baseline)} stroke="var(--qw-crux)" strokeWidth={1} strokeDasharray="4 3" opacity={0.7} />
              <text x={W - padR} y={y(M.baseline) - 5} fontSize={9.5} fill="var(--qw-crux)" textAnchor="end" fontFamily="var(--qw-mono)">
                baseline {M.fmt(M.baseline)}
              </text>
            </g>
          )}
          <text x={padL} y={padT - 5} fontSize={9} fill="var(--qw-fg-faint)" fontFamily="var(--qw-mono)">
            {M.fmt(hi)}
          </text>
          <text x={padL} y={H - padB + 12} fontSize={9} fill="var(--qw-fg-faint)" fontFamily="var(--qw-mono)">
            {M.fmt(lo)}
          </text>
          <path d={linePath} fill="none" stroke={trendUp ? 'var(--qw-ok)' : 'var(--qw-danger)'} strokeWidth={1.6} strokeLinejoin="round" opacity={0.55} />
          {pts.map((p, i) => {
            const col = ptColor(p.ok)
            const on = sel === p.run.experimentId
            return (
              <g key={p.run.experimentId} className="cursor-pointer" onClick={() => setSel(on ? null : p.run.experimentId)}>
                {p.sem > 0 && <line x1={x(i)} y1={y(p.v - p.sem)} x2={x(i)} y2={y(p.v + p.sem)} stroke={col} strokeWidth={1.4} opacity={0.45} />}
                <circle cx={x(i)} cy={y(p.v)} r={on ? 6 : 4} fill={col} stroke="var(--qw-bg-elev)" strokeWidth={1.5} />
                {p.ok === false && (
                  <path
                    d={`M${(x(i) - 2.2).toFixed(1)} ${(y(p.v) - 2.2).toFixed(1)} l4.4 4.4 M${(x(i) + 2.2).toFixed(1)} ${(y(p.v) - 2.2).toFixed(1)} l-4.4 4.4`}
                    stroke="var(--qw-bg)"
                    strokeWidth={1.1}
                  />
                )}
                <text x={x(i)} y={H - padB + 14} fontSize={8.5} fill={on ? 'var(--qw-fg)' : 'var(--qw-fg-faint)'} textAnchor="middle" fontFamily="var(--qw-mono)">
                  {(timeAgo(p.run.finishedAt ?? p.run.startedAt) || '').replace(' ago', '')}
                </text>
              </g>
            )
          })}
        </svg>

        <div className="mt-2 flex flex-wrap items-center gap-3.5">
          {([['passed gates', 'var(--qw-ok)'], ['failed gates', 'var(--qw-danger)'], ['skipped / unknown', 'var(--qw-fg-muted)']] as const).map(([l, c]) => (
            <span key={l} className="inline-flex items-center gap-1.5 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
              <span className="size-2 rounded-full" style={{ background: c }} />
              {l}
            </span>
          ))}
          <span className="ml-auto font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
            whisker = ±SEM · click a point
          </span>
        </div>

        {selPt && (
          <div className="mt-3 flex flex-wrap items-center gap-3.5 pt-3" style={{ borderTop: '1px solid var(--qw-border)' }}>
            <Chip tone="crux" mono>
              {selPt.run.experimentId.slice(0, 8)}
            </Chip>
            <Chip tone={selPt.ok === false ? 'danger' : selPt.ok === true ? 'ok' : 'muted'} dot>
              {selPt.ok === false ? 'gates failed' : selPt.ok === true ? 'gates ok' : selPt.run.verdict}
            </Chip>
            <span className="font-mono text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
              {M.label} <b style={{ color: 'var(--qw-fg)' }}>{M.fmt(selPt.v)}</b>
              {selPt.sem > 0 ? ` ±${selPt.sem.toFixed(2)}` : ''}
            </span>
            <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {timeAgo(selPt.run.finishedAt ?? selPt.run.startedAt)}
            </span>
            <div className="ml-auto">
              <Btn size="xs" icon={<Icon name="flask" size={11} />} onClick={() => onOpen(selPt.run.experimentId)}>
                Open experiment
              </Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
