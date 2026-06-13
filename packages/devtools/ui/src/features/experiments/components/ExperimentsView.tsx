/**
 * Experiments — immutable runs of an evaluation (case × variant × trial).
 *
 * List: spec-02 summary rows. Detail: the full ExperimentRecord — variant
 * aggregates (±SEM), gates (incl. informational), paired-difference
 * comparison, and the failing cells with assertion sourceRefs + trace links.
 */

import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip, Kpi, SectionHead, type ChipTone } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { usePromoteBaselineMutation } from '@/shared/hooks/useQualityMutations'
import { useQualityExperiments, useQualityExperimentDetail } from '@/shared/hooks/useQualityApi'
import { SkeletonRows } from '@/shared/components/Skeleton'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import type {
  QualityExperimentSummary,
  QualityExperimentDetail,
  QualityExperimentCell,
  QualityVariantAggregate,
} from '@/types'

function replayTone(mode: string): ChipTone {
  if (mode === 'replay-strict') return 'iris'
  if (mode === 'record-new' || mode === 'refresh') return 'warn'
  return 'muted'
}

function cellStatusTone(status: string): ChipTone {
  if (status === 'passed') return 'ok'
  if (status === 'failed') return 'danger'
  if (status === 'errored') return 'danger'
  return 'muted'
}

function formatPct(n: number | undefined): string {
  return n != null ? `${(n * 100).toFixed(0)}%` : '—'
}

function formatLatency(ms: number | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatCost(n: number | undefined): string {
  if (n == null) return '—'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

function formatScore(stat: { mean: number; sem: number } | undefined): string {
  if (!stat) return '—'
  return `${stat.mean.toFixed(2)} ±${stat.sem.toFixed(2)}`
}

function formatDelta(meanDelta: number, sem: number): string {
  const sign = meanDelta >= 0 ? '+' : ''
  return `Δ ${sign}${meanDelta.toFixed(2)} ±${sem.toFixed(2)}`
}

function timeAgo(iso: string | undefined): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (!ts) return ''
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function shortId(id: string): string {
  return id.length > 10 ? `…${id.slice(-8)}` : id
}

// ─── List ───────────────────────────────────────────────────────────

export function ExperimentsView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const { data, loading, error } = useQualityExperiments()
  const rows = data ?? []
  const failedCount = rows.filter((r) => !r.passed).length

  return (
    <QwShell
      activeView="experiments"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Evaluate / Experiments"
      title="Experiments"
      subtitle={`${rows.length} in window${failedCount > 0 ? ' · ' + failedCount + ' failed' : ''}`}
      connected={connected}
      actions={
        <Btn icon={<Icon name="flask" size={13} />} onClick={() => navigate({ view: 'evaluations' })}>
          Evaluations
        </Btn>
      }
    >
      <div>
        <div
          className="sticky top-0 z-10 grid items-center gap-3 px-8 py-2 text-[10.5px] font-medium uppercase tracking-[0.08em]"
          style={{
            gridTemplateColumns: '1fr 110px 90px 70px 70px 70px 92px',
            color: 'var(--qw-fg-faint)',
            background: 'var(--qw-bg)',
            borderBottom: '1px solid var(--qw-border)',
          }}
        >
          <div>evaluation</div>
          <div>replay</div>
          <div className="text-right">cells</div>
          <div className="text-right">gates</div>
          <div className="text-right">variants</div>
          <div className="text-right">verdict</div>
          <div className="text-right">created</div>
        </div>

        {loading && rows.length === 0 && (
          <div className="px-8 py-6">
            <SkeletonRows rows={8} rowHeight={42} />
          </div>
        )}

        {error && (
          <div className="px-8 py-12 text-center text-[13px]" style={{ color: 'var(--qw-danger)' }}>
            {error.message}
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="px-8 py-12 text-center text-[13px]" style={{ color: 'var(--qw-fg-muted)' }}>
            No experiments yet. Run <code className="font-mono">crux quality run</code>; records land under{' '}
            <code className="font-mono">.crux/quality/experiments</code>.
          </div>
        )}

        {rows.map((e) => (
          <ExperimentRow key={e.experimentId} e={e} onOpen={() => navigate({ view: 'experiment-detail', experimentId: e.experimentId })} />
        ))}
      </div>
    </QwShell>
  )
}

function ExperimentRow({ e, onOpen }: { e: QualityExperimentSummary; onOpen: () => void }) {
  const passRate = e.cells - e.cellsSkipped > 0 ? e.cellsPassed / (e.cells - e.cellsSkipped) : undefined
  return (
    <button
      onClick={onOpen}
      className="grid w-full items-center gap-3 px-8 py-3 text-left text-[12.5px] transition-colors hover:opacity-90"
      style={{
        gridTemplateColumns: '1fr 110px 90px 70px 70px 70px 92px',
        borderBottom: '1px solid var(--qw-border)',
      }}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{e.evaluationId}</span>
          {e.experimentLabel && <Chip tone="iris">{e.experimentLabel}</Chip>}
          {e.filteredRun && <Chip tone="warn">filtered</Chip>}
        </div>
        <span className="truncate font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {shortId(e.experimentId)}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Chip tone={replayTone(e.replayMode)} mono>
          {e.replayMode}
        </Chip>
      </div>
      <span
        className="text-right font-mono text-[11.5px] font-semibold"
        style={{
          color:
            passRate == null
              ? 'var(--qw-fg-faint)'
              : passRate >= 0.85
                ? 'var(--qw-ok)'
                : passRate >= 0.5
                  ? 'var(--qw-warn)'
                  : 'var(--qw-danger)',
        }}
      >
        {e.cellsPassed}/{e.cells - e.cellsSkipped}
      </span>
      <div className="flex items-center justify-end gap-1">
        {e.gatesInformational ? (
          <Chip tone="muted">info</Chip>
        ) : e.gatesPassed ? (
          <Chip tone="ok" dot>
            pass
          </Chip>
        ) : (
          <Chip tone="danger" dot>
            {e.gateFailures > 0 ? `${e.gateFailures}✗` : 'fail'}
          </Chip>
        )}
      </div>
      <span className="text-right font-mono text-[11.5px]">
        {e.variants.length}
        {e.hasComparison ? (e.comparisonDemoted ? ' ⚠' : ' Δ') : ''}
      </span>
      <span className="text-right">
        <Chip tone={e.passed ? 'ok' : 'danger'}>{e.passed ? 'passed' : 'failed'}</Chip>
      </span>
      <span className="text-right font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
        {timeAgo(e.startedAt)}
      </span>
    </button>
  )
}

// ─── Detail ─────────────────────────────────────────────────────────

interface ExperimentDetailProps {
  experimentId: string
}

export function ExperimentDetailView({ experimentId }: ExperimentDetailProps) {
  const connected = useConnected()
  const { navigate } = useNavigation()
  const promote = usePromoteBaselineMutation()
  const { data: exp, loading, error } = useQualityExperimentDetail(experimentId)

  if (!exp) {
    return (
      <QwShell
        activeView="experiments"
        onNavigate={(v) => navigate(navTarget(v))}
        breadcrumb={`Evaluate / Experiments / ${experimentId}`}
        title={loading ? 'Loading…' : 'Experiment not found'}
        connected={connected}
      >
        {loading ? (
          <div className="px-8 py-6">
            <SkeletonRows rows={10} rowHeight={42} />
          </div>
        ) : (
          <div className="px-8 py-10 text-[13px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {error ? error.message : `No experiment with id ${experimentId}.`}
          </div>
        )}
      </QwShell>
    )
  }

  const variantNames = exp.variants.map((v) => v.name)
  const scoreNames = collectScoreNames(exp)
  const failingFirst = [...exp.cases].sort((a, b) => rank(a.status) - rank(b.status))

  return (
    <QwShell
      activeView="experiments"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb={`Evaluate / Experiments / ${exp.experimentId}`}
      title={exp.evaluationId}
      subtitle={`${shortId(exp.experimentId)} · ${exp.variants.length} variant${exp.variants.length === 1 ? '' : 's'} · ${exp.cases.length} cells · replay ${exp.replay.mode}`}
      connected={connected}
      actions={
        <Btn
          variant="primary"
          icon={<Icon name="bookmark" size={13} />}
          onClick={() => promote({ experimentId: exp.experimentId, variant: exp.baselineRef?.variantName })}
        >
          Promote
        </Btn>
      }
    >
      <div className="px-8 pb-10 pt-5">
        {/* KPI ribbon */}
        <div className="mb-6 grid grid-cols-5 gap-3">
          <Kpi label="Verdict" value={exp.passed ? 'passed' : 'failed'} />
          <Kpi label="Cells" value={String(exp.cases.length)} />
          <Kpi
            label="Gates"
            value={exp.gates.informational ? 'info' : exp.gates.passed ? 'pass' : 'fail'}
            sublabel={exp.filteredRun ? 'filtered run' : undefined}
          />
          <Kpi label="Replay" value={exp.replay.mode} sublabel={exp.replay.cassette} />
          <Kpi label="Fingerprint" value={exp.configFingerprint.slice(0, 8)} sublabel="config" />
        </div>

        {/* Variant aggregates */}
        <SectionHead eyebrow="Variant aggregates" />
        <div
          className="mb-6 overflow-x-auto rounded-[10px]"
          style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
        >
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--qw-border)' }}>
                <Th>variant</Th>
                <Th align="right">pass</Th>
                {scoreNames.map((s) => (
                  <Th key={s} align="right">
                    {s}
                  </Th>
                ))}
                <Th align="right">latency</Th>
                <Th align="right">cost</Th>
              </tr>
            </thead>
            <tbody>
              {variantNames.map((name) => {
                const agg: QualityVariantAggregate | undefined = exp.aggregates.perVariant[name]
                const isBaseline = exp.baselineRef?.variantName === name || exp.comparison?.baseline === name
                return (
                  <tr key={name} style={{ borderBottom: '1px solid var(--qw-border)' }}>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Chip tone={isBaseline ? 'crux' : 'muted'} mono>
                          {name}
                        </Chip>
                        {isBaseline && <Chip tone="crux">baseline</Chip>}
                      </div>
                    </Td>
                    <Td align="right" mono>
                      {formatPct(agg?.passRate)}
                    </Td>
                    {scoreNames.map((s) => (
                      <Td key={s} align="right" mono>
                        {formatScore(agg?.scores[s])}
                      </Td>
                    ))}
                    <Td align="right" mono>
                      {formatLatency(agg?.latency.meanMs)}
                    </Td>
                    <Td align="right" mono>
                      {formatCost(agg?.costUsd)}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Comparison */}
        {exp.comparison && (
          <>
            <SectionHead eyebrow={`Comparison · ${exp.comparison.kind} vs ${exp.comparison.baseline}`} />
            {exp.comparison.demoted && (
              <div className="mb-2 text-[11.5px]" style={{ color: 'var(--qw-warn)' }}>
                informational — {exp.comparison.demoted.reason}
              </div>
            )}
            <div
              className="mb-6 overflow-hidden rounded-[10px]"
              style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
            >
              {exp.comparison.deltas.map((d, i) => (
                <div
                  key={`${d.variantName}-${d.scoreName}-${i}`}
                  className="grid items-center gap-3 px-4 py-2.5 text-[12px]"
                  style={{ gridTemplateColumns: '1fr 1fr 160px 60px', borderBottom: '1px solid var(--qw-border)' }}
                >
                  <Chip tone="muted" mono>
                    {d.variantName}
                  </Chip>
                  <span className="font-mono text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                    {d.scoreName}
                  </span>
                  <span
                    className="font-mono text-[11.5px] font-semibold"
                    style={{ color: d.meanDelta >= 0 ? 'var(--qw-ok)' : 'var(--qw-danger)' }}
                  >
                    {formatDelta(d.meanDelta, d.sem)}
                  </span>
                  <span className="text-right font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                    n={d.n}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Gates */}
        {exp.gates.results.length > 0 && (
          <>
            <SectionHead eyebrow="Gates" />
            <div
              className="mb-6 overflow-hidden rounded-[10px]"
              style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
            >
              {exp.gates.results.map((g, i) => (
                <div
                  key={`${g.gate}-${i}`}
                  className="grid items-center gap-3 px-4 py-2.5 text-[12px]"
                  style={{ gridTemplateColumns: '1fr 110px 110px 70px', borderBottom: '1px solid var(--qw-border)' }}
                >
                  <span className="font-mono text-[11.5px]">
                    {g.gate}
                    {g.variantName ? ` · ${g.variantName}` : ''}
                  </span>
                  <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                    threshold {String(g.threshold)}
                  </span>
                  <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                    actual {String(g.actual)}
                  </span>
                  <span className="text-right">
                    {g.informational ? (
                      <Chip tone="muted">info</Chip>
                    ) : (
                      <Chip tone={g.passed ? 'ok' : 'danger'}>{g.passed ? '✓' : '✗'}</Chip>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Cells (failing first) */}
        <SectionHead eyebrow="Cells" />
        <div
          className="overflow-hidden rounded-[10px]"
          style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
        >
          {failingFirst.map((c, i) => (
            <CellRow
              key={`${c.caseId}-${c.variantName}-${c.trial}-${i}`}
              cell={c}
              onOpenTrace={(traceId) => navigate({ view: 'run-detail', traceId })}
            />
          ))}
        </div>
      </div>
    </QwShell>
  )
}

function CellRow({ cell, onOpenTrace }: { cell: QualityExperimentCell; onOpenTrace: (traceId: string) => void }) {
  const failure = cell.assertions.failures[0]
  return (
    <div className="px-4 py-3 text-[12px]" style={{ borderBottom: '1px solid var(--qw-border)' }}>
      <div className="flex items-center gap-2.5">
        <Chip tone={cellStatusTone(cell.status)} dot>
          {cell.status}
        </Chip>
        <span className="truncate font-mono text-[11.5px]">{cell.caseName ?? cell.caseId}</span>
        <Chip tone="muted" mono>
          {cell.variantName}
        </Chip>
        {cell.trial > 0 && (
          <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
            trial {cell.trial}
          </span>
        )}
        <span className="ml-auto font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {formatLatency(cell.durationMs)} · {formatCost(cell.costUsd)}
        </span>
      </div>

      {cell.scores.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-2 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {cell.scores.map((s) => (
            <span key={s.name}>
              {s.name}: {s.score == null ? '—' : s.score.toFixed(2)}
              {s.label ? ` (${s.label})` : ''}
            </span>
          ))}
        </div>
      )}

      {failure && (
        <div className="mt-1.5 text-[11.5px]" style={{ color: 'var(--qw-danger)' }}>
          <span className="font-mono">{failure.matcher}</span>: {failure.message}
          {failure.sourceRef && (
            <span className="ml-2 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {failure.sourceRef}
            </span>
          )}
          {cell.assertions.notEvaluated > 0 && (
            <span className="ml-2" style={{ color: 'var(--qw-fg-faint)' }}>
              · {cell.assertions.ran} ran · {cell.assertions.notEvaluated} not evaluated
            </span>
          )}
        </div>
      )}

      {cell.error && (
        <div className="mt-1.5 text-[11.5px]" style={{ color: 'var(--qw-danger)' }}>
          <span className="font-mono">[{cell.error.phase}]</span> {cell.error.message}
          {cell.error.missingCassetteKey && (
            <span className="ml-2 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
              missing cassette key: {cell.error.missingCassetteKey}
            </span>
          )}
        </div>
      )}

      {cell.traceIds.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {cell.traceIds.map((traceId) => (
            <button
              key={traceId}
              onClick={() => onOpenTrace(traceId)}
              className="font-mono text-[10.5px] underline-offset-2 hover:underline"
              style={{ color: 'var(--qw-crux)' }}
            >
              trace → {shortId(traceId)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Th({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return (
    <th
      className={`px-3 py-2 text-[10px] font-medium uppercase tracking-[0.08em] ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ color: 'var(--qw-fg-faint)' }}
    >
      {children}
    </th>
  )
}

function Td({ children, align, mono }: { children: React.ReactNode; align?: 'right'; mono?: boolean }) {
  return (
    <td className={`px-3 py-2.5 ${align === 'right' ? 'text-right' : 'text-left'} ${mono ? 'font-mono text-[11.5px]' : ''}`}>
      {children}
    </td>
  )
}

function rank(status: string): number {
  if (status === 'errored') return 0
  if (status === 'failed') return 1
  if (status === 'skipped') return 2
  return 3
}

function collectScoreNames(exp: QualityExperimentDetail): string[] {
  const names = new Set<string>()
  for (const agg of Object.values(exp.aggregates.perVariant)) {
    for (const name of Object.keys(agg.scores)) names.add(name)
  }
  return Array.from(names).sort()
}
