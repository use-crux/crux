/**
 * Experiments — list of immutable runs over suites with optional variants.
 *
 * List columns: id, name, status, suite, pass%, score, cost/p50, variants, time.
 * Detail screen renders the variant matrix (cases × variants × scores).
 */

import { useMemo } from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip, HeatCell, Kpi, SectionHead, type ChipTone } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { usePromoteBaselineMutation } from '@/shared/hooks/useQualityMutations'
import {
  useQualityExperiments,
  useQualityExperimentsSuspense,
} from '@/shared/hooks/useQualityApi'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonRows } from '@/shared/components/Skeleton'
import { qk } from '@/shared/query/queryClient'
import { useToast } from '@/qw/shell/useToast'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected, useEvalRuns, useRagEvalRuns, useFlowRuns } from '@/app/runtime/runtimeStore'
import type { QualityExperimentRecord } from '@/types'

function statusTone(status: string): ChipTone {
  if (status === 'passed') return 'ok'
  if (status === 'running') return 'crux'
  if (status === 'failed' || status === 'error') return 'danger'
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

function ExperimentProgress({ done, total }: { done: number; total: number }) {
  const pct = Math.min(100, (done / total) * 100)
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="relative h-1 w-[64px] overflow-hidden rounded-full"
        style={{ background: 'var(--qw-bg-muted)' }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, background: 'var(--qw-crux)' }}
        />
      </div>
      <span className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
        {done}/{total}
      </span>
    </div>
  )
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

// ─── List ───────────────────────────────────────────────────────────

export function ExperimentsView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const evalRuns = useEvalRuns()
  const ragEvalRuns = useRagEvalRuns()
  const flowRuns = useFlowRuns()
  const { toast } = useToast()
  // Suspends on first paint — caught by App-level Suspense. Subsequent
  // WS pushes refresh in the background without re-suspending.
  const rows = useQualityExperimentsSuspense()
  const failedCount = rows.filter((r) => r.status === 'failed' || r.status === 'error').length
  const legacyCount = evalRuns.length + ragEvalRuns.length + flowRuns.length

  return (
    <QwShell
      activeView="experiments"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Evaluate / Experiments"
      title="Experiments"
      subtitle={`${rows.length} in window${failedCount > 0 ? ' · ' + failedCount + ' failed' : ''}${legacyCount > 0 ? ' · ' + legacyCount + ' legacy eval/flow' : ''}`}
      connected={connected}
      actions={
        <>
          <Btn
            icon={<Icon name="filter" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Filter by suite',
                message: 'Suite filter UI is next — for now use the Suites screen to drill into one suite.',
              })
            }
          >
            All suites
          </Btn>
          <Btn
            variant="primary"
            icon={<Icon name="play" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Start an experiment',
                message: 'Run `crux quality experiments new` or call experiment().run() from your test runner.',
              })
            }
          >
            New experiment
          </Btn>
        </>
      }
    >
      <div>
        <div
          className="sticky top-0 z-10 grid items-center gap-3 px-8 py-2 text-[10.5px] font-medium uppercase tracking-[0.08em]"
          style={{
            gridTemplateColumns: '90px 1fr 110px 90px 70px 80px 110px 60px 92px',
            color: 'var(--qw-fg-faint)',
            background: 'var(--qw-bg)',
            borderBottom: '1px solid var(--qw-border)',
          }}
        >
          <div>id</div>
          <div>experiment</div>
          <div>status</div>
          <div>suite</div>
          <div className="text-right">pass</div>
          <div className="text-right">score</div>
          <div className="text-right">cost / dur</div>
          <div className="text-right">variants</div>
          <div className="text-right">created</div>
        </div>

        {rows.length === 0 && legacyCount === 0 && (
          <div className="px-8 py-12 text-center text-[13px]" style={{ color: 'var(--qw-fg-muted)' }}>
            No experiments yet. Persisted under <code className="font-mono">.crux/quality/experiments</code>.
          </div>
        )}

        {rows.map((e) => {
          const passRate = e.summary.total > 0 ? e.summary.passed / e.summary.total : undefined
          return (
            <button
              key={e.id}
              onClick={() => navigate({ view: 'experiment-detail', experimentId: e.id })}
              className="grid w-full items-center gap-3 px-8 py-3 text-left text-[12.5px] transition-colors hover:opacity-90"
              style={{
                gridTemplateColumns: '90px 1fr 110px 90px 70px 80px 110px 60px 92px',
                borderBottom: '1px solid var(--qw-border)',
              }}
            >
              <span className="truncate font-mono text-[11.5px]" style={{ color: 'var(--qw-crux)' }}>
                {e.id}
              </span>
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{e.suite.name ?? e.suite.id}</span>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <Chip tone={statusTone(e.status)} dot>
                  {e.status}
                </Chip>
                {e.progress &&
                  e.progress.casesTotal > 0 &&
                  e.progress.casesDone < e.progress.casesTotal && (
                    <ExperimentProgress done={e.progress.casesDone} total={e.progress.casesTotal} />
                  )}
              </div>
              <span className="truncate font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                {e.suite.id}
              </span>
              <span
                className="text-right font-mono text-[11.5px] font-semibold"
                style={{
                  color:
                    passRate == null
                      ? 'var(--qw-fg-faint)'
                      : passRate >= 0.85
                        ? 'var(--qw-ok)'
                        : passRate >= 0.7
                          ? 'var(--qw-crux)'
                          : passRate >= 0.5
                            ? 'var(--qw-warn)'
                            : 'var(--qw-danger)',
                }}
              >
                {formatPct(passRate)}
              </span>
              <span className="text-right font-mono text-[11.5px] font-semibold">—</span>
              <span
                className="text-right font-mono text-[11px]"
                style={{ color: 'var(--qw-fg-muted)' }}
              >
                {formatCost(undefined)}
              </span>
              <span className="text-right font-mono text-[11.5px]">{e.variants.length}</span>
              <span
                className="text-right font-mono text-[11px]"
                style={{ color: 'var(--qw-fg-faint)' }}
              >
                {timeAgo(e.startedAt)}
              </span>
            </button>
          )
        })}

        {legacyCount > 0 && (
          <div className="mt-8 px-8">
            <div className="mb-3 flex items-center gap-3">
              <span
                className="text-[10.5px] font-medium uppercase tracking-[0.2em]"
                style={{ color: 'var(--qw-crux)' }}
              >
                Legacy eval / flow runs
              </span>
              <div className="h-px flex-1" style={{ background: 'var(--qw-border)' }} />
              <span
                className="font-mono text-[11px]"
                style={{ color: 'var(--qw-fg-faint)' }}
              >
                {legacyCount} from in-memory devtools
              </span>
            </div>
            <div
              className="overflow-hidden rounded-[10px]"
              style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
            >
              {evalRuns.map((r) => (
                <LegacyRow
                  key={`eval-${r.evalId}`}
                  kind="prompt-eval"
                  id={r.evalId}
                  name={r.promptId ?? r.evalId}
                  status={r.status}
                  passed={r.summary?.passed ?? 0}
                  total={r.summary?.total ?? r.totalCases}
                  startedAt={r.startedAt}
                />
              ))}
              {ragEvalRuns.map((r) => (
                <LegacyRow
                  key={`rag-${r.evalId}`}
                  kind="rag-eval"
                  id={r.evalId}
                  name={r.suiteId ?? r.evalId}
                  status={r.status}
                  passed={r.summary?.passed ?? 0}
                  total={r.summary?.total ?? r.caseCount}
                  startedAt={r.startedAt}
                />
              ))}
              {flowRuns.map((r) => (
                <LegacyRow
                  key={`flow-${r.flowId}`}
                  kind="flow-eval"
                  id={r.flowId}
                  name={r.name}
                  status={r.status}
                  passed={r.summary?.passed ?? 0}
                  total={r.summary?.total ?? r.totalCases}
                  startedAt={r.startedAt}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </QwShell>
  )
}

// ─── Legacy row (for evalRuns / ragEvalRuns / flowRuns) ─────────────

function LegacyRow({
  kind,
  id,
  name,
  status,
  passed,
  total,
  startedAt,
}: {
  kind: 'prompt-eval' | 'rag-eval' | 'flow-eval'
  id: string
  name: string
  status: string
  passed: number
  total: number
  startedAt: number
}) {
  const passRate = total > 0 ? passed / total : undefined
  return (
    <div
      className="grid items-center gap-3 px-4 py-2.5 text-[12px]"
      style={{
        gridTemplateColumns: '100px 1fr 100px 80px 90px',
        borderBottom: '1px solid var(--qw-border)',
      }}
    >
      <Chip tone="iris" mono>
        {kind}
      </Chip>
      <div className="min-w-0">
        <div className="truncate font-medium">{name}</div>
        <div className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {id.slice(0, 28)}
        </div>
      </div>
      <Chip
        tone={
          status === 'completed'
            ? 'ok'
            : status === 'running'
              ? 'crux'
              : 'muted'
        }
        dot={status === 'running'}
      >
        {status}
      </Chip>
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
        {passRate != null ? `${Math.round(passRate * 100)}%` : '—'}
      </span>
      <span
        className="text-right font-mono text-[11px]"
        style={{ color: 'var(--qw-fg-faint)' }}
      >
        {timeAgo(new Date(startedAt).toISOString())}
      </span>
    </div>
  )
}

// ─── Detail (matrix) ────────────────────────────────────────────────

interface ExperimentDetailProps {
  experimentId: string
}

export function ExperimentDetailView({ experimentId }: ExperimentDetailProps) {
  const connected = useConnected()
  const { navigate } = useNavigation()
  const { toast } = useToast()
  const promote = usePromoteBaselineMutation()
  const { data: experimentsList, loading: experimentsLoading } = useQualityExperiments()
  const exp = (experimentsList ?? []).find((e) => e.id === experimentId)
  const stillLoading = experimentsLoading && !experimentsList

  if (!exp) {
    return (
      <QwShell
        activeView="experiments"
        onNavigate={(v) => navigate(navTarget(v))}
        breadcrumb={`Evaluate / Experiments / ${experimentId}`}
        title={stillLoading ? 'Loading…' : 'Experiment not found'}
        connected={connected}
      >
        {stillLoading ? (
          <SectionBoundary
            title="Experiment"
            invalidateKeys={[qk.quality.experiments()]}
            fallback={<div className="px-8 py-6"><SkeletonRows rows={10} rowHeight={42} /></div>}
          >
            <div className="px-8 py-6">
              <SkeletonRows rows={10} rowHeight={42} />
            </div>
          </SectionBoundary>
        ) : (
          <div className="px-8 py-10 text-[13px]" style={{ color: 'var(--qw-fg-muted)' }}>
            No experiment with id <code className="font-mono">{experimentId}</code>.
          </div>
        )}
      </QwShell>
    )
  }

  // Group cases by caseId across variants
  const caseGroups = useMemo(() => {
    const byCase = new Map<string, Map<string, QualityExperimentRecord['cases'][number]>>()
    for (const c of exp.cases) {
      const m = byCase.get(c.caseId) ?? new Map()
      m.set(c.variantId, c)
      byCase.set(c.caseId, m)
    }
    return Array.from(byCase.entries()).map(([caseId, byVariant]) => ({
      caseId,
      caseName: byVariant.values().next().value?.caseName ?? caseId,
      byVariant,
    }))
  }, [exp.cases])

  const passRate = exp.summary.total > 0 ? exp.summary.passed / exp.summary.total : undefined

  return (
    <QwShell
      activeView="experiments"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb={`Evaluate / Experiments / ${exp.id}`}
      title={exp.suite.name ?? exp.id}
      subtitle={`${exp.id} · ${exp.variants.length} variant${exp.variants.length === 1 ? '' : 's'} · ${exp.suite.caseCount} cases`}
      connected={connected}
      actions={
        <>
          <Btn
            icon={<Icon name="play" size={13} />}
            onClick={() =>
              toast({
                kind: 'info',
                title: 'Rerun experiment',
                message: 'Run `crux quality experiments rerun ' + exp.id + '` or trigger from your test runner.',
              })
            }
          >
            Rerun
          </Btn>
          <Btn
            icon={<Icon name="compare" size={13} />}
            onClick={() => navigate({ view: 'compare' })}
          >
            Compare
          </Btn>
          <Btn
            variant="primary"
            icon={<Icon name="bookmark" size={13} />}
            onClick={() => promote({ experimentId: exp.id, variantId: exp.baselineVariantId })}
          >
            Promote
          </Btn>
        </>
      }
    >
      <div className="px-8 pb-10 pt-5">
        {/* KPI ribbon */}
        <div className="mb-6 grid grid-cols-5 gap-3">
          <Kpi label="Pass rate" value={formatPct(passRate)} sublabel={`${exp.summary.passed}/${exp.summary.total}`} />
          <Kpi label="Failed" value={String(exp.summary.failed)} sublabel="cases" />
          <Kpi label="Errored" value={String(exp.summary.errored)} sublabel="cases" />
          <Kpi label="Variants" value={String(exp.variants.length)} />
          <Kpi label="Status" value={exp.status} />
        </div>

        <SectionHead eyebrow="Variant matrix" />
        <div
          className="overflow-hidden rounded-[10px]"
          style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
        >
          <div
            className="grid"
            style={{
              gridTemplateColumns: `320px repeat(${exp.variants.length}, 1fr)`,
              borderBottom: '1px solid var(--qw-border)',
            }}
          >
            <div
              className="px-[18px] py-3.5"
              style={{ background: 'var(--qw-bg-muted)', borderRight: '1px solid var(--qw-border)' }}
            >
              <div
                className="mb-1 text-[10.5px] font-mono uppercase tracking-[0.12em]"
                style={{ color: 'var(--qw-fg-faint)' }}
              >
                Case
              </div>
              <div className="font-mono text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
                {caseGroups.length} cases · {exp.suite.id}
              </div>
            </div>
            {exp.variants.map((v) => {
              const stats = exp.summary.byVariant[v.id]
              const variantPass = stats && stats.total > 0 ? stats.passed / stats.total : undefined
              const primary = v.id === exp.baselineVariantId
              return (
                <div
                  key={v.id}
                  className="relative px-[18px] py-3.5"
                  style={{
                    background: primary ? 'var(--qw-crux-soft)' : 'transparent',
                    borderRight: '1px solid var(--qw-border)',
                  }}
                >
                  {primary && (
                    <div
                      className="absolute inset-x-0 top-0 h-0.5"
                      style={{ background: 'var(--qw-crux)' }}
                    />
                  )}
                  <div className="flex items-center gap-1.5">
                    <Chip tone={primary ? 'crux' : 'muted'} mono>
                      {v.id}
                    </Chip>
                    {primary && <Chip tone="crux">baseline</Chip>}
                  </div>
                  <div className="mt-1 font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                    {v.targetId}
                  </div>
                  <div className="mt-2.5 flex gap-3.5 font-mono text-[11px]">
                    <div>
                      <div
                        className="text-[9.5px] uppercase tracking-[0.08em]"
                        style={{ color: 'var(--qw-fg-faint)' }}
                      >
                        pass
                      </div>
                      <div className="text-[13px] font-semibold">{formatPct(variantPass)}</div>
                    </div>
                    <div>
                      <div
                        className="text-[9.5px] uppercase tracking-[0.08em]"
                        style={{ color: 'var(--qw-fg-faint)' }}
                      >
                        total
                      </div>
                      <div className="text-[13px] font-semibold">{stats?.total ?? 0}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {caseGroups.map((group, i) => (
            <div
              key={group.caseId}
              className="grid text-[12px]"
              style={{
                gridTemplateColumns: `320px repeat(${exp.variants.length}, 1fr)`,
                borderBottom: i === caseGroups.length - 1 ? 'none' : '1px solid var(--qw-border)',
              }}
            >
              <div
                className="flex flex-col gap-[3px] px-[18px] py-3"
                style={{ borderRight: '1px solid var(--qw-border)' }}
              >
                <span className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  {group.caseId}
                </span>
                <span className="font-normal">{group.caseName}</span>
              </div>
              {exp.variants.map((v) => {
                const c = group.byVariant.get(v.id)
                if (!c) {
                  return (
                    <div
                      key={v.id}
                      className="px-[18px] py-3 text-[11px]"
                      style={{
                        color: 'var(--qw-fg-faint)',
                        borderRight: '1px solid var(--qw-border)',
                      }}
                    >
                      —
                    </div>
                  )
                }
                const status = c.status === 'passed' ? 'pass' : c.status === 'failed' ? 'fail' : 'partial'
                const score = c.status === 'passed' ? 1 : c.status === 'failed' ? 0 : 0.5
                return (
                  <div
                    key={v.id}
                    className="flex items-center gap-2.5 px-[18px] py-3"
                    style={{
                      borderRight: '1px solid var(--qw-border)',
                      background: v.id === exp.baselineVariantId ? 'var(--qw-crux-soft)' : 'transparent',
                    }}
                  >
                    <HeatCell status={status} score={score} />
                    <span className="truncate font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                      {formatLatency(c.durationMs)}
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </QwShell>
  )
}
