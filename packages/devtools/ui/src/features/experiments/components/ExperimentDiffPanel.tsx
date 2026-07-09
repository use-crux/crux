/**
 * Experiment diff panel (blueprint §12.3).
 *
 * `ExperimentDiffPanelView` renders a §6.3 ExperimentDiff: per-score delta rows
 * (mean A/B, delta, SEM, significance), a per-case table with click-through to
 * either side's experiment, onlyInA/onlyInB lists, and — when the identities
 * drifted (`comparable: false`) — a demotion banner. It still renders the diff
 * when demoted (I2). Presentational, so it is SSR render-testable.
 * `ExperimentDiffSection` wires the compare picker + read model.
 */

import * as React from 'react'
import { Chip, Eyebrow, SectionHead } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { shortId } from '@/qw/shell/qualityKit'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useQualityEvaluationExperiments, useQualityExperimentDiff } from '@/shared/hooks/useQualityApi'
import type { QualityExperimentDetail, QualityExperimentDiff } from '@/types'
import { comparePickerOptions, driftLabel, formatSignedDelta } from '../lib/diff-format'

export function ExperimentDiffPanelView({
  diff,
  loading,
  onOpenExperiment,
}: {
  diff: QualityExperimentDiff | null | undefined
  loading?: boolean
  onOpenExperiment: (experimentId: string) => void
}) {
  if (loading && !diff) {
    return (
      <div className="px-4 py-4 font-mono text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
        computing diff…
      </div>
    )
  }
  if (!diff) return null

  return (
    <div className="flex flex-col gap-3">
      {!diff.comparable && (
        <div
          className="flex items-center gap-2 rounded-[10px] px-3.5 py-2.5 text-[12.5px]"
          style={{ background: 'var(--qw-warn-soft)', boxShadow: 'inset 0 0 0 1px var(--qw-warn-line)', color: 'var(--qw-warn)' }}
        >
          <Icon name="alert" size={14} color="var(--qw-warn)" strokeWidth={2.4} />
          <span>
            Not directly comparable — {driftLabel(diff.fingerprintDrift)} drifted. Deltas are shown for reference only.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 font-mono text-[11.5px]">
        <Chip tone="muted" mono>
          A · {shortId(diff.a.experimentId)}
        </Chip>
        <Icon name="arrowRight" size={12} color="var(--qw-fg-faint)" />
        <Chip tone="crux" mono>
          B · {shortId(diff.b.experimentId)}
        </Chip>
        <span className="ml-auto" style={{ color: 'var(--qw-fg-muted)' }}>
          gates {diff.gatesVerdict.aPassed ? 'pass' : 'fail'} → {diff.gatesVerdict.bPassed ? 'pass' : 'fail'}
        </span>
      </div>

      {diff.scores.length > 0 && (
        <div className="overflow-hidden rounded-[10px]" style={{ border: '1px solid var(--qw-border)' }}>
          {diff.scores.map((s, i) => {
            const worse = s.delta < 0
            return (
              <div
                key={s.name}
                className="grid items-center gap-2 px-3.5 py-2 font-mono text-[11.5px]"
                style={{
                  gridTemplateColumns: '1fr auto auto auto auto',
                  borderBottom: i === diff.scores.length - 1 ? 'none' : '1px solid var(--qw-border)',
                }}
              >
                <span className="font-semibold" style={{ color: 'var(--qw-fg)' }}>
                  {s.name}
                </span>
                <span style={{ color: 'var(--qw-fg-muted)' }}>{s.aMean.toFixed(2)}</span>
                <span style={{ color: 'var(--qw-fg-muted)' }}>{s.bMean.toFixed(2)}</span>
                <span style={{ color: worse ? 'var(--qw-danger)' : 'var(--qw-ok)' }}>{formatSignedDelta(s.delta)}</span>
                {s.significant ? (
                  <Chip tone={worse ? 'danger' : 'ok'}>±{s.sem.toFixed(2)} · sig</Chip>
                ) : (
                  <span style={{ color: 'var(--qw-fg-faint)' }}>±{s.sem.toFixed(2)}</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {diff.cases.length > 0 && (
        <div className="flex flex-col gap-1">
          <Eyebrow>Cases · {diff.cases.length}</Eyebrow>
          {diff.cases.map((c) => (
            <div
              key={`${c.caseId}:${c.variant}`}
              className="flex items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 font-mono text-[11px]"
              style={{ background: 'var(--qw-bg-muted)' }}
            >
              <Chip tone={c.aPassed ? 'ok' : 'danger'}>A {c.aPassed ? '✓' : '✕'}</Chip>
              <Chip tone={c.bPassed ? 'ok' : 'danger'}>B {c.bPassed ? '✓' : '✕'}</Chip>
              <span className="truncate" style={{ color: 'var(--qw-fg)' }}>
                {c.caseId} · {c.variant}
              </span>
              <span className="ml-auto flex items-center gap-2" style={{ color: 'var(--qw-fg-muted)' }}>
                {Object.entries(c.scoreDeltas).map(([name, delta]) => (
                  <span key={name} style={{ color: delta < 0 ? 'var(--qw-danger)' : 'var(--qw-fg-muted)' }}>
                    {name} {formatSignedDelta(delta)}
                  </span>
                ))}
                <button title="open A" onClick={() => onOpenExperiment(diff.a.experimentId)} style={{ color: 'var(--qw-fg-faint)' }}>
                  A→
                </button>
                <button title="open B" onClick={() => onOpenExperiment(diff.b.experimentId)} style={{ color: 'var(--qw-fg-faint)' }}>
                  B→
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {(diff.onlyInA.length > 0 || diff.onlyInB.length > 0) && (
        <div className="flex flex-col gap-1 font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {diff.onlyInA.length > 0 && <span>only in A: {diff.onlyInA.join(', ')}</span>}
          {diff.onlyInB.length > 0 && <span>only in B: {diff.onlyInB.join(', ')}</span>}
        </div>
      )}
    </div>
  )
}

/** Compare-picker + diff panel for an experiment detail (blueprint §12.3). */
export function ExperimentDiffSection({ experiment }: { experiment: QualityExperimentDetail }) {
  const { navigate } = useNavigation()
  const [pick, setPick] = React.useState<string>('')
  const { data: rel } = useQualityEvaluationExperiments(experiment.evaluationId, 50)
  const options = comparePickerOptions(rel?.experiments ?? [], experiment.experimentId)
  const { data: diff, loading } = useQualityExperimentDiff(pick ? experiment.experimentId : null, pick || null)

  return (
    <>
      <SectionHead
        eyebrow="Compare"
        right={
          <select
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="rounded-[7px] px-2.5 py-1.5 font-mono text-[11.5px]"
            style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)', color: 'var(--qw-fg)' }}
          >
            <option value="">Compare with…</option>
            {options.map((o) => (
              <option key={o.experimentId} value={o.experimentId}>
                {shortId(o.experimentId)} · {o.startedAt.slice(0, 10)}
              </option>
            ))}
          </select>
        }
      />
      {pick ? (
        <div className="mb-5">
          <ExperimentDiffPanelView
            diff={diff}
            loading={loading}
            onOpenExperiment={(experimentId) => navigate({ view: 'experiment-detail', experimentId })}
          />
        </div>
      ) : (
        <div className="mb-5 flex items-center gap-2 px-1 text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
          <Icon name="compare" size={13} />
          Pick another run of this evaluation to see per-score and per-case deltas.
        </div>
      )}
    </>
  )
}
