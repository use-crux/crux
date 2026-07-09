/**
 * Evaluations — the launching pad. Read-only: evaluations are source-defined
 * (spec-02 EvaluationManifests); the workbench discovers and displays them,
 * never edits. A finder rail grouped by task kind + a detail panel that makes
 * each kind feel native. Runs are launched from the CLI — the UI shows the
 * command and observes the resulting experiments.
 */

import * as React from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { Chip, Kpi, SectionHead } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { FilterButton, SearchButton } from '@/qw/shell/FilterPopover'
import {
  CliHint,
  QEmpty,
  ReplayBadge,
  ScorerChip,
  TaskGlyph,
  TaskKindTag,
  fmtPct,
  shortId,
  timeAgo,
  type TaskKind,
  type VerdictState,
} from '@/qw/shell/qualityKit'
import { EvalProgressStrip } from './EvalProgressStrip'
import { JudgeReportPanel } from '@/features/scorers/components/JudgeReportPanel'
import { navTarget } from '@/app/navigation/navTarget'
import {
  useQualityEvaluations,
  useQualityBaselines,
  useQualityEvaluationExperimentGroups,
  useQualityEvaluationExperiments,
} from '@/shared/hooks/useQualityApi'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import { SkeletonRows } from '@/shared/components/Skeleton'
import type { QualityEvaluationManifest, QualityExperimentSummary } from '@/types'

const KIND_ORDER: TaskKind[] = ['flow', 'agent', 'prompt', 'retriever', 'fn']

interface EvalSignals {
  hasBaseline: boolean
  lastRun?: string
  lastVerdict?: 'passed' | 'failed' | 'informational'
  lastPassRate?: number
}

function lastRunVerdict(e: QualityExperimentSummary): 'passed' | 'failed' | 'informational' {
  if (e.gatesInformational || e.filteredRun) return 'informational'
  return e.passed ? 'passed' : 'failed'
}

export function EvaluationsView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const { data: evals, loading } = useQualityEvaluations()
  const { data: baselines } = useQualityBaselines()
  // Latest-per-evaluation comes from the grouped relation, so we never scan the
  // full experiment record set in the browser.
  const { data: experimentGroups } = useQualityEvaluationExperimentGroups()
  const list = evals ?? []
  const [sel, setSel] = React.useState<string | null>(null)
  const [kind, setKind] = React.useState<string>('all')
  const [search, setSearch] = React.useState<string | undefined>(undefined)

  const allKinds = React.useMemo(() => [...new Set(list.map((e) => e.task.kind))].sort(), [list])

  // Apply the kind + name filters before grouping/selection.
  const filtered = React.useMemo(() => {
    const q = search?.trim().toLowerCase()
    return list.filter((e) => {
      if (kind !== 'all' && e.task.kind !== kind) return false
      if (q && !e.id.toLowerCase().includes(q)) return false
      return true
    })
  }, [list, kind, search])

  // Default selection: first evaluation still visible under the active filter.
  const selectedId = (sel && filtered.some((e) => e.id === sel) ? sel : filtered[0]?.id) ?? null
  const active = filtered.find((e) => e.id === selectedId) ?? null

  // Derived per-evaluation signals (baseline + most-recent run).
  const signals = React.useMemo(() => {
    const baselineIds = new Set((baselines ?? []).map((b) => b.evaluationId))
    const byEval = new Map<string, QualityExperimentSummary>()
    for (const g of experimentGroups?.groups ?? []) {
      let latest: QualityExperimentSummary | undefined
      for (const x of g.experiments) {
        if (!latest || Date.parse(x.startedAt) > Date.parse(latest.startedAt)) latest = x
      }
      if (latest) byEval.set(g.evaluationId, latest)
    }
    const out = new Map<string, EvalSignals>()
    for (const e of list) {
      const latest = byEval.get(e.id)
      const scored = latest ? Math.max(1, latest.cells - latest.cellsSkipped) : 0
      out.set(e.id, {
        hasBaseline: baselineIds.has(e.id) || !!e.baseline,
        lastRun: latest ? timeAgo(latest.startedAt) : undefined,
        lastVerdict: latest ? lastRunVerdict(latest) : undefined,
        lastPassRate: latest ? latest.cellsPassed / scored : undefined,
      })
    }
    return out
  }, [list, baselines, experimentGroups])

  const byKind = React.useMemo(() => {
    const map = new Map<string, QualityEvaluationManifest[]>()
    for (const e of filtered) {
      const k = e.task.kind
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(e)
    }
    return map
  }, [filtered])

  const orderedKinds = [...KIND_ORDER.filter((k) => byKind.has(k)), ...[...byKind.keys()].filter((k) => !KIND_ORDER.includes(k as TaskKind))]

  return (
    <QwShell
      activeView="evaluations"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Evaluate / Evaluations"
      title="Evaluations"
      subtitle={`${list.length} checks discovered from source · read-only`}
      connected={connected}
      actions={
        list.length > 0 ? (
          <>
            <FilterButton
              title="Task kind"
              value={kind}
              noneValue="all"
              options={[{ value: 'all', label: 'All kinds' }, ...allKinds.map((k) => ({ value: k, label: k }))]}
              onChange={setKind}
            />
            <SearchButton value={search} onChange={setSearch} placeholder="evaluation id" />
          </>
        ) : undefined
      }
      noScroll
    >
      {loading && list.length === 0 ? (
        <div className="px-8 py-6">
          <SkeletonRows rows={8} rowHeight={48} />
        </div>
      ) : list.length === 0 ? (
          <QEmpty
            icon="layers"
            title="No evaluations found"
            body={
            <>
              Write an <code className="font-mono">evaluate(…)</code> check in your source and it shows up here. The
              workbench discovers them — it never authors them.
              </>
            }
            action={<CliHint cmd="crux quality list" />}
          />
      ) : filtered.length === 0 ? (
        <QEmpty
          icon="filter"
          title="No evaluations match"
          body="No discovered evaluation matches the current kind/search filter. Clear the filter to see all checks."
        />
      ) : (
        <div className="flex h-full min-h-0">
          {/* finder rail */}
          <div className="w-[320px] flex-shrink-0 overflow-auto" style={{ borderRight: '1px solid var(--qw-border)', background: 'var(--qw-bg)' }}>
            {orderedKinds.map((k) => (
              <div key={k}>
                <div className="flex items-center gap-2 px-4 pb-1.5 pt-2.5">
                  <TaskKindTag kind={k} />
                  <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                    {byKind.get(k)!.length}
                  </span>
                </div>
                {byKind.get(k)!.map((e) => {
                  const on = e.id === selectedId
                  const sig = signals.get(e.id)
                  return (
                    <button
                      key={e.id}
                      onClick={() => setSel(e.id)}
                      className="flex w-full items-center gap-2.5 py-2.5 pl-[18px] pr-4 text-left"
                      style={{ background: on ? 'var(--qw-crux-soft)' : 'transparent', boxShadow: on ? 'inset 2px 0 0 var(--qw-crux)' : 'none' }}
                    >
                      <TaskGlyph kind={e.task.kind} size={24} />
                      <div className="min-w-0 flex-1">
                        <div
                          className="truncate font-mono text-[12px]"
                          style={{ color: on ? 'var(--qw-crux)' : 'var(--qw-fg)', fontWeight: on ? 600 : 450 }}
                        >
                          {e.id}
                        </div>
                        <div className="mt-0.5 flex items-center gap-[7px]">
                          <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                            {e.cases.length} cases
                          </span>
                          {sig?.lastVerdict && (
                            <span
                              className="size-[5px] rounded-full"
                              style={{ background: sig.lastVerdict === 'passed' ? 'var(--qw-ok)' : sig.lastVerdict === 'failed' ? 'var(--qw-danger)' : 'var(--qw-fg-faint)' }}
                            />
                          )}
                        </div>
                      </div>
                      {!e.explicitId && (
                        <span title="id not pinned in source" style={{ color: 'var(--qw-warn)' }}>
                          <Icon name="alert" size={12} />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* detail */}
          <div className="min-w-0 flex-1 overflow-auto">
            {active ? <EvaluationDetail e={active} sig={signals.get(active.id)} /> : <QEmpty icon="layers" title="No evaluation selected" body="Pick an evaluation from the rail." />}
          </div>
        </div>
      )}
    </QwShell>
  )
}

function EvaluationDetail({ e, sig }: { e: QualityEvaluationManifest; sig?: EvalSignals }) {
  const replayMode = e.replay?.mode ?? 'live'
  const isLive = replayMode === 'live'
  const previewCases = e.cases.slice(0, 5)
  return (
    <div className="max-w-[880px] px-7 pb-10 pt-[22px]">
      {/* hero */}
      <div className="mb-[18px] flex items-start gap-4">
        <TaskGlyph kind={e.task.kind} size={46} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="m-0 font-mono text-[21px] font-semibold tracking-[-0.02em]">{e.id}</h2>
            <TaskKindTag kind={e.task.kind} />
            {!e.explicitId && (
              <Chip tone="warn" dot>
                id not pinned
              </Chip>
            )}
          </div>
          {e.description && (
            <p className="mt-2 text-[13.5px] leading-[1.5]" style={{ color: 'var(--qw-fg-muted)', fontFamily: 'var(--qw-serif)' }}>
              {e.description}
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Chip tone="muted" mono>
              {e.source === 'prompt-tests' ? `prompt:${e.id}` : e.file || '(inline)'}
            </Chip>
            {e.task.ref && (
              <Chip tone="muted" mono>
                {e.task.ref}
              </Chip>
            )}
            {e.tags.map((tg) => (
              <Chip key={tg} tone="muted">
                {tg}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      {/* at-a-glance */}
      <div className="mb-5 grid grid-cols-4 gap-2.5">
        <Kpi label="Cases" value={String(e.cases.length)} sublabel={e.trials > 1 ? `${e.trials} trials each` : '1 trial'} />
        <Kpi
          label="Variants"
          value={String(Math.max(1, e.variants.length))}
          sublabel={e.variants.length ? e.variants.map((v) => v.name).join(' · ') : 'default'}
        />
        <Kpi
          label="Last run"
          value={sig?.lastVerdict ? fmtPct(sig.lastPassRate) : 'never'}
          sublabel={sig?.lastRun ?? 'no runs yet'}
        />
        <Kpi
          label="Baseline"
          value={sig?.hasBaseline ? 'locked' : 'none'}
          sublabel={e.baseline ? `variant · ${e.baseline}` : 'not promoted'}
        />
      </div>

      {/* progress over time — the outer "go again" loop */}
      <EvalProgressStrip evaluationId={e.id} />

      {/* experiments of this evaluation — the parent→child relation, the other
          half of the by-evaluation grouping on the Experiments list */}
      <EvalExperiments evaluationId={e.id} />

      {/* scorers */}
      {e.scorers.length > 0 && (
        <>
          <SectionHead eyebrow="Scores on" />
          <div className="mb-5 flex flex-wrap gap-2">
            {e.scorers.map((s) => (
              <ScorerChip key={s.name} name={s.name} costClass={s.costClass} />
            ))}
          </div>
        </>
      )}

      {/* judge trust — judge-vs-human agreement for model-graded scorers */}
      {e.scorers.some((s) => s.costClass && s.costClass !== 'code') && (
        <>
          <SectionHead eyebrow="Judge trust" />
          <div className="mb-5">
            <JudgeReportPanel evaluationId={e.id} />
          </div>
        </>
      )}

      {/* posture + run */}
      <div className="mb-5 grid grid-cols-2 gap-3.5">
        <div className="rounded-[10px] px-4 py-3.5" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
          <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
            Default replay posture
          </div>
          <ReplayBadge mode={replayMode} size="md" />
          <p className="mt-2.5 text-[11.5px] leading-[1.5]" style={{ color: 'var(--qw-fg-muted)' }}>
            {isLive ? 'Runs make real model calls.' : 'Replays deterministically from a cassette — free and repeatable in CI.'}
          </p>
        </div>
          <div className="rounded-[10px] px-4 py-3.5" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
              Run it
            </div>
            <CliHint cmd={`crux quality run ${e.id}`} note="Runs are launched from the CLI; the workbench observes them live." />
          </div>
      </div>

      {/* cases preview */}
      <SectionHead
        eyebrow={`Cases · ${e.cases.length}`}
        right={
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            read-only · defined in source
          </span>
        }
      />
      <div className="overflow-hidden rounded-[10px]" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
        {previewCases.map((c, i) => (
          <div
            key={c.caseId}
            className="flex items-center gap-2.5 px-3.5 py-2.5 text-[12.5px]"
            style={{ borderBottom: i === previewCases.length - 1 ? 'none' : '1px solid var(--qw-border)' }}
          >
            <span className="w-7 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="flex-1 truncate">{c.name ?? c.caseId}</span>
            {c.skip && <Chip tone="muted">skip</Chip>}
            {c.only && <Chip tone="crux">only</Chip>}
            <Chip tone="muted" mono>
              {c.hasExpect ? 'has expect' : 'no expect'}
            </Chip>
          </div>
        ))}
        {e.cases.length > 5 && (
          <div className="px-3.5 py-2 font-mono text-[11.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
            + {e.cases.length - 5} more
          </div>
        )}
      </div>
    </div>
  )
}

// ── Experiments OF this evaluation — the parent→child relation. A scoped,
// browsable list (the global Experiments feed, filtered to one eval) so an
// evaluation owns its run history, not just the aggregate trend. Backed by the
// dedicated relation read, which is newest-first and reports the full retained
// `total` before any limit. The promoted-baseline run is tinted + chipped.
function evalExpVerdict(e: QualityExperimentSummary): VerdictState {
  if (e.status === 'running' || e.experimentId.startsWith('running:')) return 'running'
  if (e.gatesInformational || e.filteredRun) return 'informational'
  return e.passed ? 'passed' : 'failed'
}

function EvalExperiments({ evaluationId }: { evaluationId: string }) {
  const { navigate } = useNavigation()
  const { data: relation, loading } = useQualityEvaluationExperiments(evaluationId)
  const { data: baselines } = useQualityBaselines()
  const experiments = relation?.experiments ?? []
  const total = relation?.total ?? 0
  const baselineExperimentId = (baselines ?? []).find((b) => b.evaluationId === evaluationId)?.experimentId

  return (
    <div className="mb-[22px]">
      <SectionHead
        eyebrow={`Experiments · ${total}`}
        right={
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            <Icon name="flask" size={12} color="var(--qw-fg-faint)" />
            runs of this evaluation · newest first
          </span>
        }
      />
      {loading && experiments.length === 0 ? (
        <SkeletonRows rows={3} rowHeight={44} />
      ) : experiments.length === 0 ? (
        <div
          className="rounded-[10px] px-4 py-[18px] text-center text-[12.5px]"
          style={{ border: '1px dashed var(--qw-border)', color: 'var(--qw-fg-muted)' }}
        >
          No runs yet — launch one from the CLI and it appears here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[12px]" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
          {experiments.map((r, i) => (
            <EvalExperimentRow
              key={r.experimentId}
              r={r}
              isBaseline={!!baselineExperimentId && r.experimentId === baselineExperimentId}
              last={i === experiments.length - 1}
              onOpen={() => {
                if (r.status === 'running' || r.experimentId.startsWith('running:')) return
                navigate({ view: 'experiment-detail', experimentId: r.experimentId })
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function EvalExperimentRow({
  r,
  isBaseline,
  last,
  onOpen,
}: {
  r: QualityExperimentSummary
  isBaseline: boolean
  last: boolean
  onOpen: () => void
}) {
  const verdict = evalExpVerdict(r)
  const running = verdict === 'running'
  const vt =
    verdict === 'passed'
      ? 'var(--qw-ok)'
      : verdict === 'failed'
        ? 'var(--qw-danger)'
        : verdict === 'running'
          ? 'var(--qw-crux)'
          : 'var(--qw-fg-muted)'
  const scored = Math.max(1, r.cells - r.cellsSkipped)
  const passRate = r.cellsPassed / scored
  return (
    <button
      onClick={onOpen}
      disabled={running}
      className="grid w-full items-center gap-3 px-4 py-[11px] text-left transition-colors hover:opacity-90 disabled:cursor-default disabled:hover:opacity-100"
      style={{
        gridTemplateColumns: '108px 1fr 96px 132px 86px 60px',
        borderBottom: last ? 'none' : '1px solid var(--qw-border)',
        background: isBaseline ? 'var(--qw-crux-soft)' : 'transparent',
      }}
    >
      {/* verdict */}
      <div className="flex items-center gap-[7px]">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: vt, animation: running ? 'cat-pulse 1.4s ease-in-out infinite' : undefined }}
        />
        <span className="text-[12px] font-semibold capitalize" style={{ color: vt }}>
          {verdict}
        </span>
      </div>
      {/* id + label + chips */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="font-mono text-[11.5px]" style={{ color: 'var(--qw-fg)' }}>
          {shortId(r.experimentId)}
        </span>
        {r.experimentLabel && (
          <span className="truncate font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {r.experimentLabel}
          </span>
        )}
        {isBaseline && (
          <Chip tone="crux" dot>
            baseline
          </Chip>
        )}
        {r.filteredRun && <Chip tone="warn">filtered</Chip>}
      </div>
      {/* pass fraction */}
      <span
        className="font-mono text-[12px] font-semibold"
        style={{
          color: running
            ? 'var(--qw-crux)'
            : passRate >= 0.8
              ? 'var(--qw-ok)'
              : passRate >= 0.6
                ? 'var(--qw-warn)'
                : 'var(--qw-danger)',
        }}
      >
        {running ? '…' : `${r.cellsPassed}/${r.cells - r.cellsSkipped}`}
      </span>
      {/* replay */}
      <div>
        <ReplayBadge mode={r.replayMode} />
      </div>
      {/* vs baseline */}
      <div>
        {r.hasComparison ? (
          r.comparisonDemoted ? (
            <Chip tone="muted">Δ demoted</Chip>
          ) : (
            <Chip tone="muted" mono>
              compared
            </Chip>
          )
        ) : (
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            —
          </span>
        )}
      </div>
      {/* started */}
      <span className="text-right font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
        {timeAgo(r.startedAt)}
      </span>
    </button>
  )
}

// Kept for callers that referenced the inner detail component by name.
export { EvaluationDetail as EvaluationDetailView }
