/**
 * Judge trust view (blueprint §12.2).
 *
 * `JudgeReportPanelView` renders the judge-vs-human agreement report for one
 * evaluation: per judge scorer, agreement %, precision/recall, Cohen's kappa,
 * a 2×2 confusion grid, and a disagreements table where each row links to the
 * cell's experiment. Empty state points at `crux quality label`. Presentational
 * (no hooks), so it is SSR render-testable. `JudgeReportPanel` wires it to the
 * read model + navigation.
 */

import { Btn, Chip, Eyebrow } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useQualityJudgeReport } from '@/shared/hooks/useQualityApi'
import type { QualityJudgeReport } from '@/types'
import { confusionGrid, formatKappa, formatRate } from '../lib/judge-report-format'

const LABEL_HINT = 'crux quality label <experiment> --case <case> --verdict pass|fail'

export function JudgeReportPanelView({
  report,
  scorerName,
  loading,
  onOpenExperiment,
}: {
  report: QualityJudgeReport | null | undefined
  scorerName?: string
  loading?: boolean
  onOpenExperiment: (experimentId: string) => void
}) {
  const scorers = (report?.scorers ?? []).filter((s) => !scorerName || s.name === scorerName)

  if (loading && !report) {
    return (
      <div className="px-4 py-4 font-mono text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
        loading judge report…
      </div>
    )
  }

  if (scorers.length === 0) {
    return (
      <div
        className="flex flex-col gap-2 rounded-[10px] px-4 py-4 text-[12.5px]"
        style={{ border: '1px dashed var(--qw-border)', color: 'var(--qw-fg-muted)' }}
      >
        <span>No human labels yet — label a few cells to measure judge trust.</span>
        <code className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {LABEL_HINT}
        </code>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {scorers.map((s) => {
        const grid = confusionGrid(s.confusion)
        return (
          <div
            key={s.name}
            className="flex flex-col gap-3 rounded-[12px] px-4 py-4"
            style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
          >
            <div className="flex flex-wrap items-center gap-2.5">
              <Icon name="sparkle" size={15} color="var(--qw-gold)" />
              <span className="font-mono text-[13px] font-semibold">{s.name}</span>
              <Chip tone="muted" mono>
                floor {s.threshold.toFixed(2)}
              </Chip>
              <span className="ml-auto font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                {s.labeled} labeled
              </span>
            </div>

            <div className="flex flex-wrap gap-4 font-mono text-[11.5px]">
              <Stat label="agreement" value={formatRate(s.agreement)} />
              <Stat label="precision" value={formatRate(s.precision)} />
              <Stat label="recall" value={formatRate(s.recall)} />
              <Stat label="kappa" value={formatKappa(s.kappa)} />
            </div>

            <div className="grid grid-cols-2 gap-1.5" style={{ maxWidth: 380 }}>
              {grid.map((cell) => (
                <div
                  key={cell.key}
                  className="flex flex-col gap-0.5 rounded-[8px] px-3 py-2"
                  style={{
                    background: cell.agree ? 'var(--qw-ok-soft)' : 'var(--qw-danger-soft)',
                    boxShadow: `inset 0 0 0 1px ${cell.agree ? 'var(--qw-ok-line)' : 'var(--qw-danger-line)'}`,
                  }}
                >
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em]" style={{ color: 'var(--qw-fg-faint)' }}>
                    {cell.label}
                  </span>
                  <span className="text-[16px] font-semibold">{cell.count}</span>
                </div>
              ))}
            </div>

            {s.disagreements.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Eyebrow>Disagreements · {s.disagreements.length}</Eyebrow>
                {s.disagreements.map((d, i) => (
                  <button
                    key={`${d.experimentId}:${d.caseId}:${d.variant}:${d.trial}:${i}`}
                    onClick={() => onOpenExperiment(d.experimentId)}
                    className="flex items-center gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left font-mono text-[11px]"
                    style={{ background: 'var(--qw-bg-muted)', color: 'var(--qw-fg-muted)', cursor: 'pointer' }}
                  >
                    <Chip tone={d.human === 'pass' ? 'ok' : 'danger'}>human {d.human}</Chip>
                    <span>judge {d.judgeScore.toFixed(2)}</span>
                    <span className="truncate" style={{ color: 'var(--qw-fg)' }}>
                      {d.caseId} · {d.variant}
                    </span>
                    <Icon name="arrowRight" size={11} className="ml-auto" color="var(--qw-fg-faint)" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span style={{ color: 'var(--qw-fg-faint)' }}>{label}</span>
      <b style={{ color: 'var(--qw-fg)' }}>{value}</b>
    </span>
  )
}

/** Judge trust panel wired to the read model + navigation. */
export function JudgeReportPanel({
  evaluationId,
  scorerName,
}: {
  evaluationId: string
  scorerName?: string
}) {
  const { navigate } = useNavigation()
  const { data: report, loading } = useQualityJudgeReport(evaluationId)
  return (
    <JudgeReportPanelView
      report={report}
      scorerName={scorerName}
      loading={loading}
      onOpenExperiment={(experimentId) => navigate({ view: 'experiment-detail', experimentId })}
    />
  )
}
