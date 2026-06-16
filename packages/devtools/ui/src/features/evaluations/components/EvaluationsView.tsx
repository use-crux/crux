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
import {
  CliHint,
  QEmpty,
  ReplayBadge,
  ScorerChip,
  TaskGlyph,
  TaskKindTag,
  fmtPct,
  timeAgo,
  type TaskKind,
} from '@/qw/shell/qualityKit'
import { EvalProgressStrip } from './EvalProgressStrip'
import { navTarget } from '@/app/navigation/navTarget'
import {
  useQualityEvaluations,
  useQualityBaselines,
  useQualityExperiments,
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
  const { data: experiments } = useQualityExperiments()
  const list = evals ?? []
  const [sel, setSel] = React.useState<string | null>(null)

  // Default selection: first discovered evaluation.
  const selectedId = sel ?? list[0]?.id ?? null
  const active = list.find((e) => e.id === selectedId) ?? null

  // Derived per-evaluation signals (baseline + most-recent run).
  const signals = React.useMemo(() => {
    const baselineIds = new Set((baselines ?? []).map((b) => b.evaluationId))
    const byEval = new Map<string, QualityExperimentSummary>()
    for (const x of experiments ?? []) {
      const prev = byEval.get(x.evaluationId)
      if (!prev || Date.parse(x.startedAt) > Date.parse(prev.startedAt)) byEval.set(x.evaluationId, x)
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
  }, [list, baselines, experiments])

  const byKind = React.useMemo(() => {
    const map = new Map<string, QualityEvaluationManifest[]>()
    for (const e of list) {
      const k = e.task.kind
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(e)
    }
    return map
  }, [list])

  const orderedKinds = [...KIND_ORDER.filter((k) => byKind.has(k)), ...[...byKind.keys()].filter((k) => !KIND_ORDER.includes(k as TaskKind))]

  return (
    <QwShell
      activeView="evaluations"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Evaluate / Evaluations"
      title="Evaluations"
      subtitle={`${list.length} checks discovered from source · read-only`}
      connected={connected}
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
          action={<CliHint cmd="crux eval --list" />}
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
          <CliHint cmd={`crux eval ${e.id}`} note="Runs are launched from the CLI; the workbench observes them live." />
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

// Kept for callers that referenced the inner detail component by name.
export { EvaluationDetail as EvaluationDetailView }
