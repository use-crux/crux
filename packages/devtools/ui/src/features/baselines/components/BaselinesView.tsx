/**
 * Baselines — "what's locked in." One card per promoted baseline: the frozen
 * reference scores future runs are measured against, a drift/verdict chip
 * derived from the latest run, and who promoted it / when. Committed to the
 * repo; CI guards these. Promotion itself happens from an experiment's detail.
 */

import * as React from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip, type ChipTone } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { useQualityBaselines, useQualityEvaluationExperimentGroups } from '@/shared/hooks/useQualityApi'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import { SkeletonCard } from '@/shared/components/Skeleton'
import { QEmpty, ScoreStat, TaskGlyph, taskKindFromId, timeAgo } from '@/qw/shell/qualityKit'
import type { QualityBaselineRecord, QualityExperimentSummary } from '@/types'

function aggregateReference(reference: QualityBaselineRecord['reference']): {
  names: string[]
  means: Record<string, number>
  caseCount: number
} {
  const sums: Record<string, { sum: number; n: number }> = {}
  const cases = Object.values(reference)
  for (const caseScores of cases) {
    for (const [k, v] of Object.entries(caseScores)) {
      ;(sums[k] ??= { sum: 0, n: 0 }).sum += v
      sums[k].n += 1
    }
  }
  const means: Record<string, number> = {}
  for (const [k, { sum, n }] of Object.entries(sums)) means[k] = n ? sum / n : 0
  return { names: Object.keys(sums), means, caseCount: cases.length }
}

interface DriftMeta {
  tone: ChipTone
  label: string
}

function driftMeta(latest: QualityExperimentSummary | undefined): DriftMeta {
  if (!latest) return { tone: 'muted', label: 'no recent run' }
  if (latest.comparisonDemoted) return { tone: 'warn', label: 'config drifted · comparison demoted' }
  if (latest.gatesInformational || latest.filteredRun) return { tone: 'muted', label: 'latest informational' }
  return latest.passed ? { tone: 'ok', label: 'latest held the bar' } : { tone: 'danger', label: 'latest regressed' }
}

export function BaselinesView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const { data: baselines, loading } = useQualityBaselines()
  // Latest-per-evaluation (and latest *compared* run per evaluation) come from
  // the grouped relation, so this screen never scans the full experiment set.
  const { data: experimentGroups } = useQualityEvaluationExperimentGroups()
  const list = baselines ?? []

  const latestByEval = React.useMemo(() => {
    const map = new Map<string, QualityExperimentSummary>()
    for (const g of experimentGroups?.groups ?? []) {
      for (const x of g.experiments) {
        const prev = map.get(x.evaluationId)
        if (!prev || Date.parse(x.startedAt) > Date.parse(prev.startedAt)) map.set(x.evaluationId, x)
      }
    }
    return map
  }, [experimentGroups])

  // The most recent run that actually carries a comparison against this
  // baseline — that's where the deltas/forest plot live. The baseline's own
  // `experimentId` is the promoted *source* run and has no comparison of its
  // own, so navigating there would dead-end on "no comparison".
  const latestComparedByEval = React.useMemo(() => {
    const map = new Map<string, QualityExperimentSummary>()
    for (const g of experimentGroups?.groups ?? []) {
      for (const x of g.experiments) {
        if (!x.hasComparison) continue
        const prev = map.get(x.evaluationId)
        if (!prev || Date.parse(x.startedAt) > Date.parse(prev.startedAt)) map.set(x.evaluationId, x)
      }
    }
    return map
  }, [experimentGroups])

  return (
    <QwShell
      activeView="baselines"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Evaluate / Baselines"
      title="Baselines"
      subtitle={`${list.length} locked · committed to the repo · CI guards these`}
      connected={connected}
    >
      <div className="flex flex-col gap-3.5 px-8 pb-10 pt-6">
        {loading && list.length === 0 ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : list.length === 0 ? (
          <QEmpty
            icon="bookmark"
            title="No baselines yet"
            body="Promote a good experiment from its detail screen to lock in the bar. Future runs and CI then measure against it."
          />
        ) : (
          <>
            {list.map((b) => {
              const { names, means, caseCount } = aggregateReference(b.reference)
              const latest = latestByEval.get(b.evaluationId)
              const dm = driftMeta(latest)
              const scored = latest ? Math.max(1, latest.cells - latest.cellsSkipped) : 0
              const latestPass = latest ? latest.cellsPassed / scored : null
              // The latest *compared* run — distinct from the baseline source.
              const compared = latestComparedByEval.get(b.evaluationId)
              const comparedIsOther = compared && compared.experimentId !== b.experimentId
              return (
                <div
                  key={b.baselineId}
                  className="grid items-center gap-6 rounded-[12px] px-5 py-[18px] text-left"
                  style={{
                    background: 'var(--qw-bg-elev)',
                    border: `1px solid ${dm.tone === 'warn' ? 'var(--qw-warn-line)' : 'var(--qw-border)'}`,
                    gridTemplateColumns: '260px 1fr 300px',
                  }}
                >
                  {/* target */}
                  <div className="flex items-start gap-3">
                    <TaskGlyph kind={taskKindFromId(b.evaluationId)} size={36} />
                    <div className="min-w-0">
                      <div className="font-mono text-[14px] font-semibold tracking-[-0.01em]">{b.evaluationId}</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Chip tone="crux" mono>
                          {b.experimentId.slice(0, 8)}
                        </Chip>
                        {b.variantName && (
                          <Chip tone="muted" mono>
                            {b.variantName}
                          </Chip>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* reference scores */}
                  <div>
                    <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
                      Frozen reference · {caseCount} case{caseCount === 1 ? '' : 's'}
                    </div>
                    <div className="flex flex-wrap gap-6">
                      {names.map((sn) => (
                        <ScoreStat key={sn} label={sn} value={means[sn]} sem={0} width={80} />
                      ))}
                      {latestPass != null && (
                        <div>
                          <div className="font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
                            latest pass
                          </div>
                          <div className="mt-1 font-mono text-[16px] font-semibold" style={{ color: 'var(--qw-ok)' }}>
                            {Math.round(latestPass * 100)}%
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* drift + promoted + actions */}
                  <div className="flex flex-col items-end gap-2">
                    <Chip tone={dm.tone} dot>
                      {dm.label}
                    </Chip>
                    <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                      promoted {timeAgo(b.promotedAt)}
                    </span>
                    <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                      {b.configFingerprint}
                    </span>
                    <div className="mt-1 flex flex-wrap justify-end gap-1.5">
                      {comparedIsOther && (
                        <Btn
                          size="xs"
                          variant="soft"
                          icon={<Icon name="diff" size={11} />}
                          onClick={() => navigate({ view: 'experiment-detail', experimentId: compared!.experimentId })}
                        >
                          Latest comparison
                        </Btn>
                      )}
                      <Btn
                        size="xs"
                        icon={<Icon name="bookmark" size={11} />}
                        onClick={() => navigate({ view: 'experiment-detail', experimentId: b.experimentId })}
                      >
                        Baseline source
                      </Btn>
                    </div>
                  </div>
                </div>
              )
            })}
            <div
              className="mt-1 flex items-center gap-2.5 rounded-[10px] px-4 py-3 text-[12px]"
              style={{ border: '1px dashed var(--qw-border)', color: 'var(--qw-fg-muted)', fontFamily: 'var(--qw-serif)' }}
            >
              <Icon name="bookmark" size={14} color="var(--qw-crux)" />
              Promotion is the one deliberate write — it commits a file the team and CI depend on. Promote from an
              experiment&rsquo;s detail screen.
            </div>
          </>
        )}
      </div>
    </QwShell>
  )
}
