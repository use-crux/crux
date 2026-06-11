/**
 * Compare — baseline vs candidate experiment diff.
 *
 * Top: run selector. Below: delta cards + case-by-case table with inline
 * output previews + a gate panel at the bottom.
 */

import { useMemo } from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip, HeatCell, SectionHead, type ChipTone } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { usePromoteBaselineMutation } from '@/shared/hooks/useQualityMutations'
import { useQualityComparisons } from '@/shared/hooks/useQualityApi'
import { useToast } from '@/qw/shell/useToast'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonCard, SkeletonRows } from '@/shared/components/Skeleton'
import { qk } from '@/shared/query/queryClient'

const KIND_TONE: Record<string, ChipTone> = {
  fixed: 'ok',
  regressed: 'danger',
  still_failing: 'danger',
  new: 'danger',
  removed: 'muted',
  unchanged: 'muted',
}
const KIND_LABEL: Record<string, string> = {
  fixed: 'Fixed',
  regressed: 'Regressed',
  still_failing: 'Still failing',
  new: 'New failure',
  removed: 'Removed',
  unchanged: 'Unchanged',
}

interface CompareProps {
  comparisonId?: string
}

function formatDelta(n: number | undefined, unit = ''): { text: string; good: boolean } {
  if (n == null) return { text: '—', good: true }
  const sign = n > 0 ? '+' : ''
  return { text: `${sign}${n.toFixed(2)}${unit}`, good: n >= 0 }
}

function formatPct(n: number | undefined): string {
  return n != null ? `${(n * 100).toFixed(1)}%` : '—'
}

export function CompareView({ comparisonId }: CompareProps) {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const promote = usePromoteBaselineMutation()
  const { toast } = useToast()
  const { data: comparisonsData, loading: comparisonsLoading } = useQualityComparisons()
  const comparisons = comparisonsData ?? []
  const cmp = comparisonId ? comparisons.find((c) => c.id === comparisonId) : comparisons[0]
  const stillLoading = comparisonsLoading && !comparisonsData

  if (!cmp) {
    return (
      <QwShell
        activeView="compare"
        onNavigate={(v) => navigate(navTarget(v))}
        breadcrumb="Evaluate / Compare"
        title={stillLoading ? 'Loading…' : 'Compare experiments'}
        subtitle={stillLoading ? undefined : 'No comparisons yet'}
        connected={connected}
        actions={
          <Btn variant="primary" icon={<Icon name="compare" size={13} />}>
            New comparison
          </Btn>
        }
      >
        {stillLoading ? (
          <SectionBoundary
            title="Comparison"
            invalidateKeys={[qk.quality.comparisons()]}
            fallback={
              <div className="flex flex-col gap-4 px-8 py-6">
                <SkeletonCard bodyLines={2} height={70} />
                <SkeletonRows rows={6} rowHeight={40} />
              </div>
            }
          >
            <div className="flex flex-col gap-4 px-8 py-6">
              <SkeletonCard bodyLines={2} height={70} />
              <SkeletonRows rows={6} rowHeight={40} />
            </div>
          </SectionBoundary>
        ) : (
          <div
            className="mx-8 mt-6 rounded-[10px] px-6 py-12 text-center text-[13px]"
            style={{
              background: 'var(--qw-bg-elev)',
              border: '1px dashed var(--qw-border)',
              color: 'var(--qw-fg-muted)',
            }}
          >
            Promote a baseline first, then run a candidate experiment to start comparing.
          </div>
        )}
      </QwShell>
    )
  }

  const counts = useMemo(() => {
    const c = { fixed: 0, regressed: 0, unchanged: 0, new: 0 }
    for (const d of cmp.caseDeltas ?? []) {
      if (d.status === 'fixed') c.fixed++
      else if (d.status === 'regressed' || d.status === 'still_failing') c.regressed++
      else if (d.status === 'new') c.new++
      else c.unchanged++
    }
    return c
  }, [cmp.caseDeltas])

  const summaryCards = useMemo(() => {
    const passDelta = formatDelta(cmp.metrics.passRateDelta * 100, 'pp')
    const durDelta = formatDelta(cmp.metrics.avgDurationMsDelta, 'ms')
    const cards: { label: string; base: string; cand: string; delta: string; good: boolean }[] = [
      {
        label: 'Pass rate',
        base: formatPct(cmp.baseline.passRate),
        cand: formatPct(cmp.candidate.passRate),
        delta: passDelta.text,
        good: passDelta.good,
      },
      {
        label: 'Avg duration',
        base: `${cmp.baseline.avgDurationMs.toFixed(0)}ms`,
        cand: `${cmp.candidate.avgDurationMs.toFixed(0)}ms`,
        delta: durDelta.text,
        good: !durDelta.good, // lower duration is better
      },
    ]
    for (const [name, d] of Object.entries(cmp.metrics.numericScoreDeltas)) {
      const dt = formatDelta(d.delta)
      cards.push({
        label: name,
        base: d.baseline != null ? d.baseline.toFixed(2) : '—',
        cand: d.candidate != null ? d.candidate.toFixed(2) : '—',
        delta: dt.text,
        good: dt.good,
      })
    }
    cards.push({
      label: 'Fixed failures',
      base: '—',
      cand: String(counts.fixed),
      delta: counts.fixed > 0 ? `+${counts.fixed}` : '0',
      good: true,
    })
    cards.push({
      label: 'New failures',
      base: '—',
      cand: String(counts.new + counts.regressed),
      delta: counts.new + counts.regressed > 0 ? `+${counts.new + counts.regressed}` : '0',
      good: counts.new + counts.regressed === 0,
    })
    return cards
  }, [cmp, counts])

  return (
    <QwShell
      activeView="compare"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb={`Evaluate / Compare / ${cmp.id}`}
      title={`${cmp.baseline.experimentId}  →  ${cmp.candidate.experimentId}`}
      subtitle={`Comparison ${cmp.id} · ${cmp.status.replace('_', ' ')}`}
      connected={connected}
      actions={
        <>
          <Btn
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Swap baseline ↔ candidate',
                message: 'New comparison creation UI coming next — re-run via the CLI for now.',
              })
            }
          >
            Swap
          </Btn>
          <Btn
            icon={<Icon name="layers" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Save regressions',
                message: 'Bulk regression → case picker is next.',
              })
            }
          >
            Save regressions
          </Btn>
          <Btn
            variant="primary"
            icon={<Icon name="bookmark" size={13} />}
            onClick={() =>
              promote({
                experimentId: cmp.candidate.experimentId,
                variantId: cmp.candidate.variantId,
                label: cmp.candidate.label,
              })
            }
          >
            Promote candidate
          </Btn>
        </>
      }
    >
      <div className="px-8 pb-10 pt-5">
        {/* Selector card */}
        <div
          className="mb-[18px] grid overflow-hidden rounded-[10px]"
          style={{
            gridTemplateColumns: '1fr 36px 1fr',
            background: 'var(--qw-bg-elev)',
            border: '1px solid var(--qw-border)',
          }}
        >
          <div className="p-4">
            <div
              className="mb-1 text-[10px] font-medium uppercase tracking-[0.16em]"
              style={{ color: 'var(--qw-fg-faint)' }}
            >
              Baseline
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[17px] font-semibold tracking-[-0.01em]">{cmp.baseline.experimentId}</span>
              {cmp.baseline.label && (
                <span className="text-[13px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  {cmp.baseline.label}
                </span>
              )}
            </div>
            <div className="mt-2 flex gap-1.5">
              <Chip tone="muted" mono>
                {cmp.baseline.total} cases
              </Chip>
              <Chip tone="muted">{formatPct(cmp.baseline.passRate)} pass</Chip>
            </div>
          </div>
          <div className="flex items-center justify-center" style={{ background: 'var(--qw-bg-muted)' }}>
            <Icon name="arrowRight" size={18} color="var(--qw-crux)" />
          </div>
          <div
            className="p-4"
            style={{ background: 'var(--qw-crux-soft)', boxShadow: 'inset 0 0 0 1px var(--qw-crux-line)' }}
          >
            <div
              className="mb-1 text-[10px] font-medium uppercase tracking-[0.16em]"
              style={{ color: 'var(--qw-crux)' }}
            >
              Candidate
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[17px] font-semibold tracking-[-0.01em]">{cmp.candidate.experimentId}</span>
              {cmp.candidate.label && (
                <span className="text-[13px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  {cmp.candidate.label}
                </span>
              )}
            </div>
            <div className="mt-2 flex gap-1.5">
              <Chip tone="crux" mono>
                {cmp.candidate.total} cases
              </Chip>
              <Chip tone="crux">{formatPct(cmp.candidate.passRate)} pass</Chip>
            </div>
          </div>
        </div>

        {/* Delta cards */}
        <div
          className="mb-6 grid gap-2.5"
          style={{ gridTemplateColumns: `repeat(${Math.min(6, summaryCards.length)}, 1fr)` }}
        >
          {summaryCards.map((s) => (
            <div
              key={s.label}
              className="rounded-[8px] p-3.5"
              style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
            >
              <div className="mb-2 text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
                {s.label}
              </div>
              <div className="flex items-baseline gap-1.5 font-mono">
                <span className="text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  {s.base}
                </span>
                <Icon name="arrowRight" size={10} color="var(--qw-fg-faint)" />
                <span className="text-[16px] font-semibold">{s.cand}</span>
              </div>
              <div
                className="mt-1.5 font-mono text-[11px] font-semibold"
                style={{ color: s.good ? 'var(--qw-ok)' : 'var(--qw-danger)' }}
              >
                {s.delta}
              </div>
            </div>
          ))}
        </div>

        <SectionHead
          eyebrow="Case-level diff"
          right={
            <div className="flex gap-1.5">
              <Chip tone="ok" dot>
                {counts.fixed} fixed
              </Chip>
              <Chip tone="danger" dot>
                {counts.regressed + counts.new} regressed
              </Chip>
              <Chip tone="muted" dot>
                {counts.unchanged} unchanged
              </Chip>
            </div>
          }
        />
        <div
          className="overflow-hidden rounded-[10px]"
          style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
        >
          {(cmp.caseDeltas ?? []).map((d, i, arr) => {
            const kind = KIND_LABEL[d.status] ?? d.status
            const tone = KIND_TONE[d.status] ?? 'muted'
            const isBad = d.status === 'regressed' || d.status === 'new' || d.status === 'still_failing'
            const score = d.scoreDelta
            return (
              <div
                key={d.caseId}
                className="grid items-center gap-3.5 px-4 py-3 text-[12px]"
                style={{
                  gridTemplateColumns: '110px 1fr 1fr 1fr 80px',
                  borderBottom: i === arr.length - 1 ? 'none' : '1px solid var(--qw-border)',
                  background: isBad ? 'var(--qw-danger-soft)' : 'transparent',
                }}
              >
                <div className="flex flex-col gap-1">
                  <Chip tone={tone} dot>
                    {kind}
                  </Chip>
                  <span className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
                    {d.caseId}
                  </span>
                </div>
                <div className="font-medium">{d.caseName ?? d.caseId}</div>
                <div className="flex min-w-0 items-center gap-2">
                  {d.baseline && (
                    <HeatCell
                      status={
                        d.baseline.status === 'passed' ? 'pass' : d.baseline.status === 'failed' ? 'fail' : 'partial'
                      }
                      score={d.baseline.score ?? 0}
                    />
                  )}
                  <span className="truncate font-serif text-[12px] italic" style={{ color: 'var(--qw-fg-muted)' }}>
                    {d.baseline?.outputPreview ?? ''}
                  </span>
                </div>
                <div className="flex min-w-0 items-center gap-2">
                  {d.candidate && (
                    <HeatCell
                      status={
                        d.candidate.status === 'passed' ? 'pass' : d.candidate.status === 'failed' ? 'fail' : 'partial'
                      }
                      score={d.candidate.score ?? 0}
                    />
                  )}
                  <span className="truncate font-serif text-[12px] italic" style={{ color: 'var(--qw-fg)' }}>
                    {d.candidate?.outputPreview ?? ''}
                  </span>
                </div>
                <span
                  className="text-right font-mono text-[13px] font-semibold"
                  style={{ color: (score ?? 0) >= 0 ? 'var(--qw-ok)' : 'var(--qw-danger)' }}
                >
                  {score != null ? (score >= 0 ? '+' : '') + score.toFixed(2) : '—'}
                </span>
              </div>
            )
          })}
        </div>

        {cmp.gates && (
          <div
            className="mt-[18px] flex items-center gap-3.5 rounded-[10px] px-[18px] py-3.5"
            style={{
              background: cmp.gates.status === 'passed' ? 'var(--qw-crux-soft)' : 'var(--qw-danger-soft)',
              border: `1px dashed ${cmp.gates.status === 'passed' ? 'var(--qw-crux-line)' : 'var(--qw-danger)'}`,
            }}
          >
            <Icon
              name={cmp.gates.status === 'passed' ? 'check' : 'alert'}
              size={20}
              color={cmp.gates.status === 'passed' ? 'var(--qw-crux)' : 'var(--qw-danger)'}
            />
            <div className="flex-1">
              <div className="text-[13.5px] font-semibold">
                Gate: {cmp.gates.status} ·{' '}
                {cmp.gates.results
                  .map((r) => `${r.name} ${r.operator === 'gte' ? '≥' : '≤'} ${r.expected} (${r.actual.toFixed(2)})`)
                  .join(' · ')}
              </div>
            </div>
            <Btn
              size="sm"
              onClick={() =>
                toast({ kind: 'info', title: 'Skipped', message: 'Re-open this comparison anytime from /compare.' })
              }
            >
              Skip
            </Btn>
            <Btn
              size="sm"
              variant="primary"
              icon={<Icon name="bookmark" size={13} />}
              onClick={() =>
                promote({
                  experimentId: cmp.candidate.experimentId,
                  variantId: cmp.candidate.variantId,
                  label: cmp.candidate.label,
                })
              }
            >
              Promote
            </Btn>
          </div>
        )}
      </div>
    </QwShell>
  )
}
