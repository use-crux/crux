/**
 * Experiments — the activity stream of quality, and the single richest screen.
 *
 * List: spec-02 summary rows — verdict, cells-passed bar, gates, replay badge,
 * the auto-computed comparison chip, filtered/stale flags.
 *
 * Detail: the full ExperimentRecord, read top to bottom —
 *   1. Verdict hero + the cost/quality tradeoff card
 *   2. Per-variant rollup (score means ±SEM)
 *   3. Comparison (rows ↔ forest plot) — honest about noise / unmatched / demotion
 *   4. Gates (blocking vs informational)
 *   5. Cells — failing-first; expand to the assertion + sourceRef + trace.
 *
 * Promotion is the one write action and lives in the header (confirm → toast).
 */

import * as React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { QwShell } from '@/qw/shell/QwShell'
import { Btn, Chip, SectionHead } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { FilterButton } from '@/qw/shell/FilterPopover'
import { QwConfirm } from '@/qw/shell/QwConfirm'
import {
  CellStatusChip,
  DeltaStat,
  ErrorBar,
  GateRow,
  QEmpty,
  ReplayBadge,
  ScoreStat,
  ScorerChip,
  TaskGlyph,
  Verdict,
  fmtCost,
  fmtLatency,
  shortId,
  taskKindFromId,
  timeAgo,
  type CellStatus,
  type VerdictState,
} from '@/qw/shell/qualityKit'
import { CellEvidenceView } from './CellEvidenceView'
import { navTarget } from '@/app/navigation/navTarget'
import { usePromoteBaselineMutation } from '@/shared/hooks/useQualityMutations'
import {
  useQualityExperimentsInfinite,
  useQualityExperimentDetail,
  useQualityBaselines,
  useQualityEvaluationExperiments,
} from '@/shared/hooks/useQualityApi'
import { SkeletonRows } from '@/shared/components/Skeleton'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useConnected } from '@/app/runtime/runtimeStore'
import {
  aggregateBaselineReference,
  candidateDeltas,
  collectRollupScoreNames,
  comparisonSides,
  realDeltas,
  shouldShowComparisonPanel,
} from '../lib/experiment-comparison-model'
import type {
  QualityBaselineRecord,
  QualityExperimentSummary,
  QualityExperimentDetail,
  QualityExperimentCell,
  QualityVariantAggregate,
  QualityExperimentComparison,
} from '@/types'

// ─── shared derivations ─────────────────────────────────────────────

function summaryVerdict(e: QualityExperimentSummary): VerdictState {
  if (e.status === 'running') return 'running'
  if (e.gatesInformational || e.filteredRun) return 'informational'
  return e.passed ? 'passed' : 'failed'
}

/** Running rows carry a synthetic `running:` id and have no persisted detail. */
function isRunning(e: QualityExperimentSummary): boolean {
  return e.status === 'running' || e.experimentId.startsWith('running:')
}

function detailVerdict(exp: QualityExperimentDetail): VerdictState {
  if (exp.gates.informational || exp.filteredRun) return 'informational'
  return exp.passed ? 'passed' : 'failed'
}

const STATUS_RANK: Record<CellStatus, number> = { errored: 0, failed: 1, passed: 2, skipped: 3 }

/** The most-moved score — the decisive metric for per-case movement chips. */
function decisiveMetric(exp: QualityExperimentDetail, scoreNames: string[]): string | null {
  const deltas = exp.comparison?.deltas ?? []
  let best: { name: string; mag: number } | null = null
  for (const d of deltas) {
    const mag = Math.abs(d.meanDelta)
    if (!best || mag > best.mag) best = { name: d.scoreName, mag }
  }
  return best?.name ?? scoreNames[0] ?? null
}

// ─── List ───────────────────────────────────────────────────────────

type ExpTab = 'all' | 'running' | 'failed' | 'informational' | 'passed'

/** Shared grid template so the pinned column header and every row line up. */
const EXP_COLS = '110px 1fr 220px 110px 150px 120px 70px'

const EMPTY_COUNTS = { all: 0, passed: 0, failed: 0, informational: 0, running: 0 }

export function ExperimentsView() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const [tab, setTab] = React.useState<ExpTab>('all')
  const [evalId, setEvalId] = React.useState<string | undefined>(undefined)
  const [timeWindow, setTimeWindow] = React.useState<'all' | '24h' | '7d' | '30d'>('all')
  // flat timeline ↔ parent→child clusters: the same loaded pages, regrouped.
  const [grouped, setGrouped] = React.useState(false)

  // Filtering + paging happen server-side; the browser only ever holds the
  // pages it has loaded, never the full record set.
  const status = tab === 'all' ? undefined : tab
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useQualityExperimentsInfinite({
    status,
    evaluation: evalId,
    window: timeWindow,
  })

  const rows = React.useMemo(() => (data?.pages ?? []).flatMap((p) => p.experiments), [data])
  // Facets are scoped to evaluation+window (ignoring status) so they're stable
  // across the status tabs; read them off the first page.
  const counts = data?.pages[0]?.statusCounts ?? EMPTY_COUNTS
  const evaluations = data?.pages[0]?.evaluations ?? []
  const total = data?.pages[0]?.total ?? rows.length
  const anyFilter = status !== undefined || evalId !== undefined || timeWindow !== 'all'

  const handleOpen = (experimentId: string) => {
    // Running rows are synthetic (`running:` id) and have no persisted detail.
    if (experimentId.startsWith('running:')) return
    navigate({ view: 'experiment-detail', experimentId })
  }

  return (
    <QwShell
      activeView="experiments"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Evaluate / Experiments"
      title="Experiments"
      subtitle={`${total} experiment${total === 1 ? '' : 's'}${counts.failed > 0 ? ` · ${counts.failed} failed` : ''}`}
      connected={connected}
      actions={
        counts.all > 0 || anyFilter ? (
          <>
            <FilterButton
              icon="layers"
              title="Evaluation"
              value={evalId ?? '__all__'}
              noneValue="__all__"
              options={[
                { value: '__all__', label: 'All evaluations' },
                ...evaluations.map((id) => ({ value: id, label: id })),
              ]}
              onChange={(v) => setEvalId(v === '__all__' ? undefined : v)}
            />
            <FilterButton
              icon="clock"
              title="Time window"
              value={timeWindow}
              noneValue="all"
              options={[
                { value: 'all', label: 'All time' },
                { value: '24h', label: 'Last 24h' },
                { value: '7d', label: 'Last 7d' },
                { value: '30d', label: 'Last 30d' },
              ]}
              onChange={(v) => setTimeWindow(v as 'all' | '24h' | '7d' | '30d')}
            />
          </>
        ) : undefined
      }
      tabs={[
        { label: 'All', active: tab === 'all', count: counts.all, onClick: () => setTab('all') },
        { label: 'Running', active: tab === 'running', count: counts.running, onClick: () => setTab('running') },
        { label: 'Failed', active: tab === 'failed', count: counts.failed, onClick: () => setTab('failed') },
        {
          label: 'Informational',
          active: tab === 'informational',
          count: counts.informational,
          onClick: () => setTab('informational'),
        },
        { label: 'Passed', active: tab === 'passed', count: counts.passed, onClick: () => setTab('passed') },
      ]}
      noScroll
    >
      {isLoading && rows.length === 0 ? (
        <div className="px-8 py-6">
          <SkeletonRows rows={12} rowHeight={48} />
        </div>
      ) : error ? (
        <QEmpty icon="alert" tone="danger" title="Couldn't load experiments" body={error.message} />
      ) : rows.length === 0 ? (
        anyFilter ? (
          <QEmpty
            icon="filter"
            title="No experiments match"
            body="No experiment matches the current status / evaluation / time-window filter."
          />
        ) : (
          <QEmpty
            icon="flask"
            title="No experiments yet"
            body={
              <>
                Run an evaluation from the CLI; records land under{' '}
                <code className="font-mono">.crux/quality/experiments</code>.
              </>
            }
          />
        )
      ) : (
        <div className="flex h-full min-h-0 flex-col">
          {/* loaded-of-total on the left, flat ↔ by-evaluation on the right.
              Paging is infinite-scroll — see the list's bottom sentinel. */}
          <div className="flex flex-shrink-0 items-center justify-between px-8 pb-0.5 pt-2.5">
            <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {rows.length} of {total}
            </span>
            <Seg
              value={grouped ? 'grouped' : 'flat'}
              onChange={(v) => setGrouped(v === 'grouped')}
              opts={[
                ['flat', 'flat'],
                ['grouped', 'by evaluation'],
              ]}
            />
          </div>
          <div className="min-h-0 flex-1">
            {grouped ? (
              <ExperimentsGrouped
                rows={rows}
                onOpen={handleOpen}
                total={total}
                fetchNextPage={fetchNextPage}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
              />
            ) : (
              <ExperimentsList
                rows={rows}
                onOpen={handleOpen}
                total={total}
                fetchNextPage={fetchNextPage}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
              />
            )}
          </div>
        </div>
      )}
    </QwShell>
  )
}

/** Cursor-paging props shared by both list views — drives infinite scroll. */
type PagingProps = {
  total: number
  fetchNextPage: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
}

/**
 * Bottom-of-list status: spinner text while a page is in flight, a quiet
 * end-of-list marker once everything is loaded. Replaces the old top-of-list
 * "Load more" button — paging is now scroll-driven.
 */
function InfiniteFooter({
  loaded,
  total,
  hasNextPage,
  isFetchingNextPage,
}: {
  loaded: number
} & Omit<PagingProps, 'fetchNextPage'>) {
  return (
    <div
      className="flex items-center justify-center gap-2 px-8 py-4 font-mono text-[11px]"
      style={{ color: 'var(--qw-fg-faint)' }}
    >
      {isFetchingNextPage ? (
        <>
          <span className="size-2 animate-pulse rounded-full" style={{ background: 'var(--qw-crux)' }} />
          Loading more…
        </>
      ) : hasNextPage ? (
        <span>Scroll for more · {loaded} of {total}</span>
      ) : loaded > 0 ? (
        <span>All {total} experiment{total === 1 ? '' : 's'} loaded</span>
      ) : null}
    </div>
  )
}

/**
 * The experiments feed can run to thousands of rows, so the list is
 * windowed with `@tanstack/react-virtual`: only the visible rows (plus a
 * small overscan) are in the DOM. The pinned column header and the rows
 * share one scroll container — and the same `EXP_COLS` grid template — so
 * columns stay aligned and the scrollbar gutter applies to both. The
 * virtualizer's `scrollMargin` is set to the header height so the windowing
 * math accounts for the header sitting above the list. Paging is infinite:
 * the next page is fetched as the last rows scroll into view (overscan ahead).
 */
function ExperimentsList({
  rows,
  onOpen,
  total,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
}: {
  rows: readonly QualityExperimentSummary[]
  onOpen: (experimentId: string) => void
} & PagingProps) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const headerRef = React.useRef<HTMLDivElement>(null)
  const sentinelRef = React.useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = React.useState(0)

  React.useLayoutEffect(() => {
    if (headerRef.current) setScrollMargin(headerRef.current.offsetHeight)
  }, [])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 10,
    scrollMargin,
    getItemKey: (index) => rows[index].experimentId,
  })
  const virtualItems = virtualizer.getVirtualItems()

  // Infinite scroll: pull the next page when the bottom sentinel scrolls into
  // view. The sentinel is a real DOM node below the virtualized window, so an
  // IntersectionObserver rooted on this scroll container fires reliably as the
  // list nears its end (rootMargin gives a prefetch lead).
  React.useEffect(() => {
    const el = sentinelRef.current
    const root = scrollRef.current
    if (!el || !root || !hasNextPage) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
      },
      { root, rootMargin: '400px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div ref={scrollRef} className="h-full overflow-auto" style={{ background: 'var(--qw-bg)' }}>
      <div
        ref={headerRef}
        className="sticky top-0 z-10 grid items-center gap-3.5 px-8 py-2 font-mono text-[10px] uppercase tracking-[0.08em]"
        style={{
          gridTemplateColumns: EXP_COLS,
          color: 'var(--qw-fg-faint)',
          background: 'var(--qw-bg)',
          borderBottom: '1px solid var(--qw-border)',
        }}
      >
        <span>verdict</span>
        <span>evaluation</span>
        <span>cells passed</span>
        <span>gates</span>
        <span>replay</span>
        <span>vs baseline</span>
        <span className="text-right">started</span>
      </div>

      {rows.length === 0 ? (
        <div className="px-8 py-8 text-center text-[12.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          No experiments match this filter.
        </div>
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
          {virtualItems.map((item) => (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start - scrollMargin}px)` }}
            >
              <ExperimentRow e={rows[item.index]} onOpen={() => onOpen(rows[item.index].experimentId)} />
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div ref={sentinelRef}>
          <InfiniteFooter
            loaded={rows.length}
            total={total}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
          />
        </div>
      )}
    </div>
  )
}

/**
 * The "by evaluation" view of the same feed: runs clustered under a
 * collapsible per-eval header (glyph + id + run count + a passed/failed/running
 * verdict rollup). Groups are ordered by their most-recent run — i.e. first
 * appearance in the already newest-first `rows`. Rendered plainly (not
 * virtualized): the cluster headers + collapse keep the visible row count
 * bounded, and the flat view stays virtualized for the thousands-of-rows case.
 */
function ExperimentsGrouped({
  rows,
  onOpen,
  total,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
}: {
  rows: readonly QualityExperimentSummary[]
  onOpen: (experimentId: string) => void
} & PagingProps) {
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const sentinelRef = React.useRef<HTMLDivElement>(null)

  // Infinite scroll: pull the next page when the bottom sentinel scrolls into
  // view. (The grouped view is plain-scrolled, not virtualized.)
  React.useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasNextPage) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage()
      },
      { rootMargin: '200px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const groups = React.useMemo(() => {
    const order: string[] = []
    const by: Record<string, { evaluationId: string; rows: QualityExperimentSummary[] }> = {}
    for (const r of rows) {
      if (!by[r.evaluationId]) {
        by[r.evaluationId] = { evaluationId: r.evaluationId, rows: [] }
        order.push(r.evaluationId)
      }
      by[r.evaluationId].rows.push(r)
    }
    return order.map((id) => by[id])
  }, [rows])

  if (rows.length === 0) {
    return (
      <div className="h-full overflow-auto px-8 py-8 text-center text-[12.5px]" style={{ background: 'var(--qw-bg)', color: 'var(--qw-fg-muted)' }}>
        No experiments match this filter.
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto" style={{ background: 'var(--qw-bg)' }}>
      {groups.map((g) => {
        const isOpen = !collapsed[g.evaluationId]
        let passed = 0
        let failed = 0
        let running = 0
        let info = 0
        for (const r of g.rows) {
          const v = summaryVerdict(r)
          if (v === 'running') running++
          else if (v === 'failed') failed++
          else if (v === 'informational') info++
          else passed++
        }
        return (
          <div key={g.evaluationId}>
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [g.evaluationId]: isOpen }))}
              className="sticky top-0 z-10 flex w-full items-center gap-2.5 px-8 py-2.5 text-left"
              style={{ background: 'var(--qw-bg-muted)', borderBottom: '1px solid var(--qw-border)' }}
            >
              <span
                className="inline-flex"
                style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}
              >
                <Icon name="arrowRight" size={13} color="var(--qw-fg-faint)" />
              </span>
              <TaskGlyph kind={taskKindFromId(g.evaluationId)} size={22} />
              <span className="font-mono text-[12.5px] font-semibold">{g.evaluationId}</span>
              <Chip tone="muted" mono>
                {g.rows.length} run{g.rows.length === 1 ? '' : 's'}
              </Chip>
              <div className="ml-auto flex items-center gap-1.5">
                {running > 0 && (
                  <Chip tone="crux" dot>
                    {running} running
                  </Chip>
                )}
                {passed > 0 && (
                  <Chip tone="ok" dot>
                    {passed} passed
                  </Chip>
                )}
                {failed > 0 && (
                  <Chip tone="danger" dot>
                    {failed} failed
                  </Chip>
                )}
                {info > 0 && <Chip tone="muted">{info} info</Chip>}
              </div>
            </button>
            {isOpen && g.rows.map((r) => <ExperimentRow key={r.experimentId} e={r} onOpen={() => onOpen(r.experimentId)} />)}
          </div>
        )
      })}
      <div ref={sentinelRef} />
      <InfiniteFooter
        loaded={rows.length}
        total={total}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
      />
    </div>
  )
}

function ExperimentRow({ e, onOpen }: { e: QualityExperimentSummary; onOpen: () => void }) {
  const verdict = summaryVerdict(e)
  const running = isRunning(e)
  const vt =
    verdict === 'passed'
      ? 'var(--qw-ok)'
      : verdict === 'failed'
        ? 'var(--qw-danger)'
        : verdict === 'running'
          ? 'var(--qw-crux)'
          : 'var(--qw-fg-muted)'
  const scored = Math.max(1, e.cells - e.cellsSkipped)
  const passRate = e.cellsPassed / scored
  const slots = Math.min(e.cells, 24)
  const passSlots = Math.round((e.cellsPassed / scored) * slots)
  const errSlots = Math.round((e.cellsErrored / Math.max(1, e.cells)) * slots)
  return (
    <button
      onClick={onOpen}
      disabled={running}
      className="grid w-full items-center gap-3.5 px-8 py-3 text-left text-[12.5px] transition-colors hover:opacity-90 disabled:cursor-default disabled:hover:opacity-100"
      style={{ gridTemplateColumns: EXP_COLS, borderBottom: '1px solid var(--qw-border)' }}
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
      {/* evaluation */}
      <div className="flex min-w-0 items-center gap-2">
        <TaskGlyph kind={taskKindFromId(e.evaluationId)} size={22} />
        <div className="min-w-0">
          <div className="truncate font-mono text-[11.5px]">{e.evaluationId}</div>
          <div className="truncate font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {shortId(e.experimentId)}
            {e.experimentLabel ? ` · ${e.experimentLabel}` : ''}
          </div>
        </div>
      </div>
      {/* cells passed */}
      <div className="flex items-center gap-2.5">
        <span
          className="w-11 font-mono text-[12px] font-semibold"
          style={{ color: passRate >= 0.8 ? 'var(--qw-ok)' : passRate >= 0.6 ? 'var(--qw-warn)' : 'var(--qw-danger)' }}
        >
          {e.cellsPassed}/{e.cells - e.cellsSkipped}
        </span>
        <div className="flex max-w-[150px] flex-1 gap-[3px]">
          {Array.from({ length: slots }).map((_, i) => {
            const pass = i < passSlots
            const err = !pass && i >= slots - errSlots
            return (
              <span
                key={i}
                className="h-3.5 flex-1 rounded-[2px]"
                style={{
                  background: pass ? 'var(--qw-ok-soft)' : err ? 'var(--qw-danger-soft)' : 'var(--qw-danger-soft)',
                  boxShadow: `inset 0 0 0 1px ${pass ? 'var(--qw-ok-line)' : 'var(--qw-border)'}`,
                }}
              />
            )
          })}
        </div>
      </div>
      {/* gates */}
      <div className="flex items-center">
        {e.gatesInformational ? (
          <Chip tone="muted">info</Chip>
        ) : e.gateFailures > 0 ? (
          <Chip tone="danger" dot>
            {e.gateFailures} gate{e.gateFailures > 1 ? 's' : ''}
          </Chip>
        ) : (
          <Chip tone="ok" dot>
            gates ok
          </Chip>
        )}
      </div>
      {/* replay */}
      <div className="flex flex-wrap items-center gap-1.5">
        <ReplayBadge mode={e.replayMode} />
        {e.filteredRun && (
          <Chip
            tone="warn"
            title="Filtered run — only a subset of cases ran (a filter, or only/skip in the suite). Its pass rate isn't comparable to a full run and it can't be promoted as a clean baseline."
          >
            filtered
          </Chip>
        )}
      </div>
      {/* vs baseline */}
      <div className="flex items-center">
        {e.hasComparison ? (
          e.comparisonDemoted ? (
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
        {timeAgo(e.startedAt)}
      </span>
    </button>
  )
}

// ─── Detail ─────────────────────────────────────────────────────────

export function ExperimentDetailView({ experimentId }: { experimentId: string }) {
  const connected = useConnected()
  const { navigate } = useNavigation()
  const promote = usePromoteBaselineMutation()
  const { data: exp, loading, error } = useQualityExperimentDetail(experimentId)
  const { data: baselines } = useQualityBaselines()
  // Reverse-context (this run is itself a promoted baseline) only needs this
  // evaluation's recent runs, so use the scoped relation, not the full list.
  const { data: evalExperiments } = useQualityEvaluationExperiments(exp?.evaluationId)

  if (!exp) {
    return (
      <QwShell
        activeView="experiments"
        onNavigate={(v) => navigate(navTarget(v))}
        breadcrumb={`Evaluate / Experiments / ${shortId(experimentId)}`}
        title={loading ? 'Loading…' : 'Experiment not found'}
        connected={connected}
      >
        {loading ? (
          <div className="px-8 py-6">
            <SkeletonRows rows={10} rowHeight={42} />
          </div>
        ) : (
          <QEmpty
            icon={error ? 'alert' : 'search'}
            tone={error ? 'danger' : 'warn'}
            title={error ? "Couldn't load this experiment" : 'Experiment not found'}
            body={error ? error.message : `No experiment matches ${experimentId} in this project.`}
            action={
              <Btn size="sm" variant="soft" icon={<Icon name="arrowRight" size={12} />} onClick={() => navigate({ view: 'experiments' })}>
                Back to experiments
              </Btn>
            }
          />
        )}
      </QwShell>
    )
  }

  const verdict = detailVerdict(exp)
  const onPromote = () =>
    void promote({ experimentId: exp.experimentId, variant: exp.baselineRef?.variantName ?? exp.comparison?.baseline })

  // Reverse context: is THIS run the promoted baseline source? If so it carries
  // no comparison of its own — point at the latest run that compared against it.
  const asBaseline = (baselines ?? []).find((b) => b.experimentId === exp.experimentId)
  const latestCompared = asBaseline
    ? (evalExperiments?.experiments ?? [])
        .filter((x) => x.hasComparison && x.experimentId !== exp.experimentId)
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0]
    : undefined
  const comparisonBaseline =
    exp.baselineRef && baselines
      ? baselines.find(
          (b) =>
            b.baselineId === exp.baselineRef?.baselineId ||
            (b.evaluationId === exp.evaluationId && b.experimentId === exp.baselineRef?.experimentId),
        )
      : undefined

  return (
    <QwShell
      activeView="experiments"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb={`Evaluate / Experiments / ${shortId(exp.experimentId)}`}
      title={exp.evaluationId}
      subtitle={`${exp.experimentLabel ? exp.experimentLabel + ' · ' : ''}${timeAgo(exp.startedAt)} · ${exp.variants.length} variant${exp.variants.length === 1 ? '' : 's'}`}
      connected={connected}
      actions={
        <>
          <Btn
            size="sm"
            icon={<Icon name="link" size={13} />}
            onClick={() => void navigator.clipboard?.writeText(window.location.href)}
          >
            Copy link
          </Btn>
          <QwConfirm
            title="Promote to baseline?"
            description={
              `This locks ${shortId(exp.experimentId)}${exp.baselineRef?.variantName ? ` · ${exp.baselineRef.variantName}` : ''} as the bar for ${exp.evaluationId}. ` +
              `It commits baselines/${exp.evaluationId}.json — the team and CI will measure future runs against it.`
            }
            confirmLabel="Promote"
            tone="crux"
            onConfirm={onPromote}
          >
            <Btn size="sm" variant="primary" icon={<Icon name="bookmark" size={13} />}>
              Promote…
            </Btn>
          </QwConfirm>
        </>
      }
    >
      <div className="mx-auto max-w-[1180px] px-8 pb-12 pt-5">
        {asBaseline && (
          <BaselineSourceBanner
            evaluationId={asBaseline.evaluationId}
            promotedAt={asBaseline.promotedAt}
            latestCompared={latestCompared}
            onOpen={(id) => navigate({ view: 'experiment-detail', experimentId: id })}
          />
        )}
        <QVerdictHero exp={exp} verdict={verdict} />
        <QVariantRollup exp={exp} baselineRecord={comparisonBaseline} />
        {exp.comparison && <QComparison cmp={exp.comparison} />}
        {exp.gates.results.length > 0 && <QGates exp={exp} />}
        <QCells exp={exp} onOpenTrace={(traceId) => navigate({ view: 'run-detail', traceId })} />
      </div>
    </QwShell>
  )
}

// ─── Reverse context: this run IS the active baseline ───────────────

function BaselineSourceBanner({
  evaluationId,
  promotedAt,
  latestCompared,
  onOpen,
}: {
  evaluationId: string
  promotedAt: string
  latestCompared: QualityExperimentSummary | undefined
  onOpen: (experimentId: string) => void
}) {
  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-2.5 rounded-[10px] px-4 py-3"
      style={{ background: 'var(--qw-crux-soft)', boxShadow: 'inset 0 0 0 1px var(--qw-crux-line)' }}
    >
      <Icon name="bookmark" size={15} color="var(--qw-crux)" />
      <span className="text-[12.5px]" style={{ color: 'var(--qw-fg)' }}>
        <b>This run is the active baseline</b> for <span className="font-mono">{evaluationId}</span> — promoted{' '}
        {timeAgo(promotedAt)}. It&rsquo;s the bar future runs measure against, so it carries no comparison of its own.
      </span>
      {latestCompared ? (
        <Btn
          size="xs"
          variant="soft"
          className="ml-auto"
          icon={<Icon name="diff" size={11} />}
          onClick={() => onOpen(latestCompared.experimentId)}
        >
          Latest compared run · {shortId(latestCompared.experimentId)}
        </Btn>
      ) : (
        <span className="ml-auto font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          no compared run yet
        </span>
      )}
    </div>
  )
}

// ─── 1 · Verdict hero ───────────────────────────────────────────────

function TradeRow({
  icon,
  label,
  verdict,
  vtone,
  last,
  children,
}: {
  icon: React.ComponentProps<typeof Icon>['name']
  label: string
  verdict?: string
  vtone?: string
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className="grid items-center gap-2.5 py-[9px]"
      style={{ gridTemplateColumns: '18px 96px 1fr', borderBottom: last ? 'none' : '1px solid var(--qw-border)' }}
    >
      <Icon name={icon} size={13} color="var(--qw-fg-faint)" />
      <span className="font-mono text-[11px] uppercase tracking-[0.06em]" style={{ color: 'var(--qw-fg-muted)' }}>
        {label}
      </span>
      <div className="flex items-center justify-end gap-2">
        {children}
        {verdict && (
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.04em]" style={{ color: vtone }}>
            {verdict}
          </span>
        )}
      </div>
    </div>
  )
}

function QVerdictHero({ exp, verdict }: { exp: QualityExperimentDetail; verdict: VerdictState }) {
  const { base, candidate: cand } = comparisonSides(exp)
  const baseAgg = exp.aggregates.perVariant[base]
  const candAgg = cand ? exp.aggregates.perVariant[cand] : undefined
  const blockingFails = exp.gates.results.filter((g) => !g.passed && !g.informational)

  const hasCostTradeoff =
    !!candAgg &&
    !!baseAgg &&
    candAgg.costUsd != null &&
    baseAgg.costUsd != null &&
    baseAgg.costUsd > 0
  const hasLatencyTradeoff = !!candAgg && !!baseAgg && baseAgg.latency.meanMs > 0
  const costPct = hasCostTradeoff ? Math.round((1 - candAgg!.costUsd! / baseAgg!.costUsd!) * 100) : null
  const latPct = hasLatencyTradeoff
    ? Math.round((1 - candAgg!.latency.meanMs / baseAgg!.latency.meanMs) * 100)
    : null
  const candDeltas = candidateDeltas(exp.comparison, cand)
  const showComparisonPanel = shouldShowComparisonPanel({
    comparison: exp.comparison,
    hasCostTradeoff,
    hasLatencyTradeoff,
    candidateDeltaCount: candDeltas.length,
  })
  const worstReg = candDeltas.reduce<(typeof candDeltas)[number] | null>(
    (acc, d) => (d.meanDelta < -d.sem && (!acc || d.meanDelta < acc.meanDelta) ? d : acc),
    null,
  )

  const reason =
    verdict === 'passed'
      ? `All gates cleared and no cells errored${exp.baselineRef ? ` — measured against baseline ${shortId(exp.baselineRef.experimentId)}` : ''}.`
      : verdict === 'informational'
        ? exp.filteredRun
          ? 'This run covered only a filtered subset, so its gates are informational — a signal, not a blocking verdict.'
          : "Gates are informational here — there's no pinned baseline (or it drifted), so nothing could block. Treat the result as a signal."
        : blockingFails.length > 0
          ? `${cand ? cand + ' fails' : 'Fails'} ${blockingFails.length} gate${blockingFails.length > 1 ? 's' : ''} — ${blockingFails
              .slice(0, 3)
              .map((g) => g.gate)
              .join(', ')}.`
          : 'A cell errored, so the run cannot pass.'

  const bottom = bottomLine(exp, verdict, { costPct: costPct ?? 0, latPct: latPct ?? 0, worstReg, hasComparisonPanel: showComparisonPanel })

  return (
    <div
      className="mb-[22px] grid gap-4"
      style={{ gridTemplateColumns: showComparisonPanel ? '1fr 380px' : '1fr' }}
    >
      <div
        className="flex flex-col gap-3.5 rounded-[12px] px-5 py-[18px]"
        style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
      >
        <div className="flex flex-wrap items-center gap-3.5">
          <Verdict
            state={verdict}
            size="lg"
            sub={`${exp.gates.results.filter((g) => !g.passed && !g.informational).length} of ${exp.gates.results.length} gates failing`}
          />
          <ReplayBadge mode={exp.replay.mode} stale={!!exp.replay.staleSince} size="md" />
          {exp.filteredRun && (
            <Chip tone="warn" dot>
              filtered run
            </Chip>
          )}
        </div>
        <p className="m-0 max-w-[560px] text-[13.5px] leading-[1.55]" style={{ color: 'var(--qw-fg-muted)', fontFamily: 'var(--qw-serif)' }}>
          {reason}
        </p>
        <div
          className="flex items-start gap-2.5 rounded-[9px] px-3.5 py-[11px]"
          style={{
            background: bottom.tone === 'ok' ? 'var(--qw-ok-soft)' : bottom.tone === 'danger' ? 'var(--qw-danger-soft)' : 'var(--qw-bg-muted)',
            boxShadow: `inset 0 0 0 1px var(--qw-${bottom.tone === 'muted' ? 'border' : bottom.tone + '-line'})`,
          }}
        >
          <Icon name={bottom.icon} size={15} color={`var(--qw-${bottom.tone === 'muted' ? 'fg-muted' : bottom.tone})`} strokeWidth={2.4} />
          <div className="text-[12.5px] leading-[1.5]" style={{ color: 'var(--qw-fg)' }}>
            {bottom.node}
          </div>
        </div>
        {exp.baselineRef && (
          <div className="flex items-center gap-2 font-mono text-[11.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
            <Icon name="bookmark" size={12} color="var(--qw-fg-faint)" />
            compared against baseline <span style={{ color: 'var(--qw-crux)' }}>{shortId(exp.baselineRef.experimentId)}</span>
            {exp.baselineRef.variantName ? ` · ${exp.baselineRef.variantName}` : ''}
          </div>
        )}
      </div>

      {showComparisonPanel && (
        <div className="rounded-[12px] px-[18px] py-3.5" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
          <div className="mb-1 flex items-center gap-2">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.12em]" style={{ color: 'var(--qw-fg-faint)' }}>
              {hasCostTradeoff ? 'The tradeoff' : 'The comparison'}
            </span>
            <span className="ml-auto font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {cand} vs {base}
            </span>
          </div>
          {costPct != null && costPct !== 0 && (
            <TradeRow icon="db" label="cost" verdict={costPct > 0 ? 'cheaper' : 'pricier'} vtone={costPct > 0 ? 'var(--qw-ok)' : 'var(--qw-danger)'}>
              <span className="font-mono text-[15px] font-semibold" style={{ color: costPct > 0 ? 'var(--qw-ok)' : 'var(--qw-danger)' }}>
                {costPct > 0 ? '−' : '+'}
                {Math.abs(costPct)}%
              </span>
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {fmtCost(candAgg!.costUsd)} vs {fmtCost(baseAgg!.costUsd)}
              </span>
            </TradeRow>
          )}
          {latPct != null && latPct !== 0 && (
            <TradeRow icon="clock" label="latency" verdict={latPct > 0 ? 'faster' : 'slower'} vtone={latPct > 0 ? 'var(--qw-ok)' : 'var(--qw-danger)'}>
              <span className="font-mono text-[15px] font-semibold" style={{ color: latPct > 0 ? 'var(--qw-ok)' : 'var(--qw-danger)' }}>
                {latPct > 0 ? '−' : '+'}
                {Math.abs(latPct)}%
              </span>
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {fmtLatency(candAgg!.latency.meanMs)} vs {fmtLatency(baseAgg!.latency.meanMs)}
              </span>
            </TradeRow>
          )}
          {!hasCostTradeoff && (
            <div className="py-2 text-[11.5px] leading-[1.45]" style={{ color: 'var(--qw-fg-faint)', borderBottom: '1px solid var(--qw-border)' }}>
              Cost tradeoff unavailable for this run; showing paired score movement against the promoted baseline.
            </div>
          )}
          {candDeltas.map((d, i) => (
            <TradeRow
              key={d.scoreName}
              icon={Math.abs(d.meanDelta) > d.sem ? (d.meanDelta < 0 ? 'arrowDown' : 'arrowUp') : 'sparkle'}
              label={d.scoreName}
              last={i === candDeltas.length - 1}
            >
              <DeltaStat delta={d.meanDelta} sem={d.sem} />
            </TradeRow>
          ))}
        </div>
      )}
    </div>
  )
}

function bottomLine(
  exp: QualityExperimentDetail,
  verdict: VerdictState,
  ctx: { costPct: number; latPct: number; worstReg: { scoreName: string; meanDelta: number } | null; hasComparisonPanel: boolean },
): { tone: 'ok' | 'danger' | 'muted'; icon: React.ComponentProps<typeof Icon>['name']; node: React.ReactNode } {
  if (verdict === 'passed') {
    return {
      tone: 'ok',
      icon: 'check',
      node: (
        <>
          <b>Looks shippable.</b> Gates held and the comparison shows no real regression.
        </>
      ),
    }
  }
  if (verdict === 'informational') {
    return {
      tone: 'muted',
      icon: 'info',
      node: (
        <>
          <b>Informational only.</b> Re-run unfiltered and promote a baseline to get a blocking verdict.
        </>
      ),
    }
  }
  if (ctx.worstReg && ctx.hasComparisonPanel && ctx.costPct > 0) {
    return {
      tone: 'danger',
      icon: 'x',
      node: (
        <>
          <b>Don&rsquo;t ship the candidate.</b> {ctx.costPct}% cheaper
          {ctx.latPct > 0 ? ` and ${ctx.latPct}% faster` : ''} doesn&rsquo;t justify a{' '}
          <b style={{ color: 'var(--qw-danger)' }}>real</b> {ctx.worstReg.meanDelta.toFixed(2)} drop in{' '}
          {ctx.worstReg.scoreName}.
        </>
      ),
    }
  }
  return {
    tone: 'danger',
    icon: 'x',
    node: (
      <>
        <b>Don&rsquo;t ship.</b> A blocking gate failed{exp.cases.some((c) => c.status === 'errored') ? ' and a cell errored' : ''}.
      </>
    ),
  }
}

// ─── 2 · Per-variant rollup ─────────────────────────────────────────

function QVariantRollup({ exp, baselineRecord }: { exp: QualityExperimentDetail; baselineRecord?: QualityBaselineRecord }) {
  const { base, candidate: cand } = comparisonSides(exp)
  const baselineReference = baselineRecord && exp.comparison?.kind === 'promoted' ? aggregateBaselineReference(baselineRecord.reference) : null
  const scoreNames = collectRollupScoreNames(exp, baselineRecord)
  const regressed = realDeltas(exp.comparison, cand)
  const cardCount = exp.variants.length + (baselineReference ? 1 : 0)
  return (
    <>
      <SectionHead
        eyebrow="Variants · score means ±SEM"
        right={
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            n = scored cells · bar = ±1 SEM
          </span>
        }
      />
      <div
        className="mb-6 grid gap-3"
        style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(1, cardCount), 3)}, minmax(0, 1fr))` }}
      >
        {baselineReference && baselineRecord && (
          <BaselineReferenceRollupCard baselineRecord={baselineRecord} reference={baselineReference} scoreNames={scoreNames} />
        )}
        {exp.variants.map((vr) => {
          const agg: QualityVariantAggregate | undefined = exp.aggregates.perVariant[vr.name]
          const isBase = vr.name === base
          const isCand = vr.name === cand
          const model = typeof vr.overrides?.model === 'string' ? vr.overrides.model : vr.overrideKeys.join(', ')
          return (
            <div
              key={vr.name}
              className="overflow-hidden rounded-[12px]"
              style={{ background: 'var(--qw-bg-elev)', border: `1px solid ${isCand ? 'var(--qw-crux-line)' : 'var(--qw-border)'}` }}
            >
              <div
                className="flex items-center gap-2 px-4 py-3"
                style={{ borderBottom: '1px solid var(--qw-border)', background: isCand ? 'var(--qw-crux-soft)' : 'transparent' }}
              >
                <Chip tone={isCand ? 'crux' : 'muted'} mono>
                  {vr.name}
                </Chip>
                {isBase && <Chip tone="muted">baseline variant</Chip>}
                {isCand && exp.comparison?.kind === 'promoted' && <Chip tone="crux">candidate</Chip>}
                {model && (
                  <span className="ml-auto truncate font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                    {model}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-4 px-4 py-3.5">
                <div className="flex items-end gap-4">
                  <div>
                    <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
                      Pass rate
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <span
                        className="font-mono text-[28px] font-semibold tracking-[-0.01em]"
                        style={{
                          color: agg && agg.passRate >= 0.8 ? 'var(--qw-ok)' : agg && agg.passRate >= 0.6 ? 'var(--qw-warn)' : 'var(--qw-danger)',
                        }}
                      >
                        {agg ? `${Math.round(agg.passRate * 100)}%` : '—'}
                      </span>
                      {agg && (
                        <span className="font-mono text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
                          {agg.passed}/{agg.passed + agg.failed + agg.errored}
                        </span>
                      )}
                    </div>
                  </div>
                  {agg && (
                    <div className="ml-auto flex gap-2.5 font-mono text-[10.5px]">
                      {agg.failed > 0 && <span style={{ color: 'var(--qw-danger)' }}>{agg.failed} failed</span>}
                      {agg.errored > 0 && <span style={{ color: 'var(--qw-danger)' }}>{agg.errored} errored</span>}
                      {agg.skipped > 0 && <span style={{ color: 'var(--qw-fg-faint)' }}>{agg.skipped} skipped</span>}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-[22px]">
                  {scoreNames.map((sn) => {
                    const s = agg?.scores[sn]
                    return (
                      <ScoreStat
                        key={sn}
                        label={sn}
                        value={s?.mean ?? null}
                        sem={s?.sem}
                        n={s?.n}
                        tone={isCand && regressed.has(sn) ? 'danger' : undefined}
                        width={84}
                      />
                    )
                  })}
                </div>
                {agg && (
                  <div
                    className="flex gap-4 pt-3 font-mono text-[11.5px]"
                    style={{ borderTop: '1px solid var(--qw-border)', color: 'var(--qw-fg-muted)' }}
                  >
                    <span>p95 {fmtLatency(agg.latency.p95Ms)}</span>
                    <span>mean {fmtLatency(agg.latency.meanMs)}</span>
                    <span className="ml-auto">{fmtCost(agg.costUsd)}</span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function BaselineReferenceRollupCard({
  baselineRecord,
  reference,
  scoreNames,
}: {
  baselineRecord: QualityBaselineRecord
  reference: ReturnType<typeof aggregateBaselineReference>
  scoreNames: readonly string[]
}) {
  const passCount = reference.passRate == null ? null : Math.round(reference.passRate * reference.caseCount)
  return (
    <div className="overflow-hidden rounded-[12px]" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
      <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--qw-border)' }}>
        <Chip tone="muted" mono>
          {shortId(baselineRecord.experimentId)}
        </Chip>
        <Chip tone="muted">promoted baseline</Chip>
      </div>
      <div className="flex flex-col gap-4 px-4 py-3.5">
        <div className="flex items-end gap-4">
          <div>
            <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
              Pass rate
            </div>
            <div className="flex items-baseline gap-1.5">
              <span
                className="font-mono text-[28px] font-semibold tracking-[-0.01em]"
                style={{
                  color:
                    reference.passRate == null
                      ? 'var(--qw-fg-faint)'
                      : reference.passRate >= 0.8
                        ? 'var(--qw-ok)'
                        : reference.passRate >= 0.6
                          ? 'var(--qw-warn)'
                          : 'var(--qw-danger)',
                }}
              >
                {reference.passRate == null ? '—' : `${Math.round(reference.passRate * 100)}%`}
              </span>
              {passCount != null && (
                <span className="font-mono text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  {passCount}/{reference.caseCount}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-[22px]">
          {scoreNames.map((name) => {
            const score = reference.scores[name]
            return <ScoreStat key={name} label={name} value={score?.mean ?? null} sem={score?.sem} n={score?.n} width={84} />
          })}
        </div>
        <div
          className="flex gap-4 pt-3 font-mono text-[11.5px]"
          style={{ borderTop: '1px solid var(--qw-border)', color: 'var(--qw-fg-muted)' }}
        >
          <span>frozen reference</span>
          <span>{reference.caseCount} case{reference.caseCount === 1 ? '' : 's'}</span>
          <span className="ml-auto">cost not retained</span>
        </div>
      </div>
    </div>
  )
}

// ─── 3 · Comparison ─────────────────────────────────────────────────

function QComparisonPlot({ cmp }: { cmp: QualityExperimentComparison }) {
  const W = 540
  const range = 0.3
  const zeroX = W / 2
  const px = (v: number) => zeroX + (Math.max(-range, Math.min(range, v)) / range) * (W / 2)
  return (
    <div className="rounded-[12px] px-[18px] py-2" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
      {cmp.deltas.map((d, i) => {
        const noise = Math.abs(d.meanDelta) <= d.sem
        const col = noise ? 'var(--qw-fg-muted)' : d.meanDelta > 0 ? 'var(--qw-ok)' : 'var(--qw-danger)'
        return (
          <div
            key={`${d.variantName}-${d.scoreName}`}
            className="grid items-center gap-4 py-4"
            style={{ gridTemplateColumns: '170px 1fr 150px', borderBottom: i === cmp.deltas.length - 1 ? 'none' : '1px solid var(--qw-border)' }}
          >
            <div>
              <ScorerChip name={d.scoreName} costClass={d.scoreName === 'helpful' ? 'model' : 'code'} />
              <div className="mt-1.5 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                paired · n={d.n}
              </div>
            </div>
            <svg width={W} height={46} className="overflow-visible" aria-hidden>
              <line x1={0} y1={23} x2={W} y2={23} stroke="var(--qw-border)" strokeWidth={1} />
              <line x1={zeroX} y1={6} x2={zeroX} y2={40} stroke="var(--qw-border-strong)" strokeWidth={1} strokeDasharray="2 2" />
              <text x={zeroX} y={4} fontSize={8.5} fill="var(--qw-fg-faint)" textAnchor="middle" fontFamily="var(--qw-mono)">
                baseline
              </text>
              <text x={2} y={44} fontSize={8} fill="var(--qw-fg-faint)" fontFamily="var(--qw-mono)">
                −0.3
              </text>
              <text x={W - 2} y={44} fontSize={8} fill="var(--qw-fg-faint)" textAnchor="end" fontFamily="var(--qw-mono)">
                +0.3
              </text>
              <line x1={px(d.meanDelta - d.sem)} y1={23} x2={px(d.meanDelta + d.sem)} y2={23} stroke={col} strokeWidth={2.5} opacity={0.4} />
              <line x1={px(d.meanDelta - d.sem)} y1={17} x2={px(d.meanDelta - d.sem)} y2={29} stroke={col} strokeWidth={1.5} opacity={0.6} />
              <line x1={px(d.meanDelta + d.sem)} y1={17} x2={px(d.meanDelta + d.sem)} y2={29} stroke={col} strokeWidth={1.5} opacity={0.6} />
              <circle cx={px(d.meanDelta)} cy={23} r={5} fill={col} />
            </svg>
            <div className="text-right">
              <DeltaStat delta={d.meanDelta} sem={d.sem} />
              <div className="mt-1 font-mono text-[10.5px]" style={{ color: noise ? 'var(--qw-fg-faint)' : col }}>
                {noise ? 'crosses zero · noise' : 'clears zero · real'}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function QComparison({ cmp }: { cmp: QualityExperimentComparison }) {
  const [view, setView] = React.useState<'rows' | 'plot'>('rows')
  return (
    <div className="mb-6">
      <SectionHead
        eyebrow={`Comparison · candidate vs ${cmp.baseline}`}
        right={
          <div className="flex items-center gap-2.5">
            <Chip tone={cmp.kind === 'promoted' ? 'crux' : 'muted'} mono>
              {cmp.kind === 'promoted' ? 'vs promoted baseline' : 'in-run variant'}
            </Chip>
            <Seg
              value={view}
              onChange={(v) => setView(v as 'rows' | 'plot')}
              opts={[
                ['rows', 'rows'],
                ['plot', 'plot'],
              ]}
            />
          </div>
        }
      />
      {view === 'plot' ? (
        <QComparisonPlot cmp={cmp} />
      ) : (
        <div className="overflow-hidden rounded-[12px]" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
          {cmp.deltas.map((d, i) => {
            const noise = Math.abs(d.meanDelta) <= d.sem
            return (
              <div
                key={`${d.variantName}-${d.scoreName}`}
                className="grid items-center gap-4 px-[18px] py-4"
                style={{ gridTemplateColumns: '180px 1fr 220px', borderBottom: i === cmp.deltas.length - 1 ? 'none' : '1px solid var(--qw-border)' }}
              >
                <div>
                  <ScorerChip name={d.scoreName} costClass={d.scoreName === 'helpful' ? 'model' : 'code'} />
                  <div className="mt-1.5 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                    paired · n={d.n}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <DeltaStat delta={d.meanDelta} sem={d.sem} size="lg" />
                  <div className="min-w-0 flex-1">
                    <ErrorBar
                      value={0.5 + d.meanDelta}
                      sem={d.sem}
                      max={1}
                      width={200}
                      tone={noise ? undefined : d.meanDelta > 0 ? 'ok' : 'danger'}
                      height={24}
                    />
                  </div>
                </div>
                <div
                  className="text-[12px] leading-[1.4]"
                  style={{ color: noise ? 'var(--qw-fg-muted)' : d.meanDelta > 0 ? 'var(--qw-ok)' : 'var(--qw-danger)', fontFamily: 'var(--qw-serif)' }}
                >
                  {noise
                    ? 'The improvement is inside the error bar — not distinguishable from noise yet.'
                    : d.meanDelta > 0
                      ? 'A real improvement — the delta clears its error bar.'
                      : 'A real regression — the drop is larger than the error bar.'}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap gap-2.5">
        {cmp.unmatchedCases.baselineOnly.length > 0 && (
          <div
            className="flex items-center gap-2 rounded-[8px] px-3 py-2 text-[11.5px]"
            style={{ background: 'var(--qw-warn-soft)', boxShadow: 'inset 0 0 0 1px var(--qw-warn-line)', color: 'var(--qw-fg)' }}
          >
            <Icon name="info" size={13} color="var(--qw-warn)" />
            <span>
              <b>{cmp.unmatchedCases.baselineOnly.join(', ')}</b> scored only on the baseline — excluded from the paired math.
            </span>
          </div>
        )}
        {cmp.unmatchedCases.candidateOnly.length > 0 && (
          <div
            className="flex items-center gap-2 rounded-[8px] px-3 py-2 text-[11.5px]"
            style={{ background: 'var(--qw-warn-soft)', boxShadow: 'inset 0 0 0 1px var(--qw-warn-line)', color: 'var(--qw-fg)' }}
          >
            <Icon name="info" size={13} color="var(--qw-warn)" />
            <span>
              <b>{cmp.unmatchedCases.candidateOnly.join(', ')}</b> scored only on the candidate — excluded from the paired math.
            </span>
          </div>
        )}
        {cmp.demoted && (
          <div
            className="flex items-center gap-2 rounded-[8px] px-3 py-2 text-[11.5px]"
            style={{ background: 'var(--qw-bg-muted)', boxShadow: 'inset 0 0 0 1px var(--qw-border)', color: 'var(--qw-fg-muted)' }}
          >
            <Icon name="alert" size={13} color="var(--qw-fg-muted)" /> Comparison demoted: {cmp.demoted.reason}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── 4 · Gates ──────────────────────────────────────────────────────

function QGates({ exp }: { exp: QualityExperimentDetail }) {
  const blocking = exp.gates.results.filter((x) => !x.informational)
  const info = exp.gates.results.filter((x) => x.informational)
  const passCount = blocking.filter((x) => x.passed).length
  const failCount = blocking.filter((x) => !x.passed).length
  return (
    <div className="mb-6">
      <SectionHead
        eyebrow="Gates · the bar"
        right={
          <span className="flex gap-1.5">
            <Chip tone={passCount ? 'ok' : 'muted'} dot>
              {passCount} pass
            </Chip>
            {failCount > 0 && (
              <Chip tone="danger" dot>
                {failCount} fail
              </Chip>
            )}
            {info.length > 0 && <Chip tone="muted">{info.length} informational</Chip>}
          </span>
        }
      />
      <div className="overflow-hidden rounded-[12px]" style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}>
        <div
          className="grid gap-3 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em]"
          style={{ gridTemplateColumns: '20px 1fr 92px 92px 96px', borderBottom: '1px solid var(--qw-border)', color: 'var(--qw-fg-faint)' }}
        >
          <span />
          <span>gate</span>
          <span className="text-right">threshold</span>
          <span className="text-right">actual</span>
          <span />
        </div>
        {blocking.map((x, i) => (
          <GateRow key={`b${i}`} {...x} variant={x.variantName} last={false} />
        ))}
        {info.map((x, i) => (
          <GateRow key={`i${i}`} {...x} variant={x.variantName} last={i === info.length - 1} />
        ))}
      </div>
      {info.length > 0 && (
        <div className="mt-2 text-[11.5px] italic" style={{ color: 'var(--qw-fg-faint)', fontFamily: 'var(--qw-serif)' }}>
          Informational gates exist but can&rsquo;t fail a run — they lack a baseline, ran on a filtered subset, or couldn&rsquo;t be evaluated.
        </div>
      )}
    </div>
  )
}

// ─── 5 · Cells ──────────────────────────────────────────────────────

interface CaseGroup {
  caseId: string
  caseName?: string
  cells: Record<string, QualityExperimentCell>
}

function groupCells(exp: QualityExperimentDetail): CaseGroup[] {
  const order: string[] = []
  const by: Record<string, CaseGroup> = {}
  for (const cell of exp.cases) {
    if (!by[cell.caseId]) {
      by[cell.caseId] = { caseId: cell.caseId, caseName: cell.caseName, cells: {} }
      order.push(cell.caseId)
    }
    // prefer trial 0; keep the first seen otherwise
    if (!by[cell.caseId].cells[cell.variantName] || cell.trial === 0) {
      by[cell.caseId].cells[cell.variantName] = cell
    }
  }
  return order.map((id) => by[id])
}

function worstStatus(g: CaseGroup): number {
  return Math.min(...Object.values(g.cells).map((c) => STATUS_RANK[c.status] ?? 9))
}

function scoreOf(cell: QualityExperimentCell | undefined, name: string | null): number | null {
  if (!cell || !name) return null
  const s = cell.scores.find((x) => x.name === name)
  return s ? s.score : null
}

interface Move {
  delta: number | null
  worse: boolean
  statusOnly: boolean
}

function caseMove(g: CaseGroup, base: string, cand: string | null, metric: string | null): Move | null {
  if (!cand) return null
  const c0 = g.cells[base]
  const c1 = g.cells[cand]
  if (!c0 || !c1) return null
  const s0 = scoreOf(c0, metric)
  const s1 = scoreOf(c1, metric)
  if (s0 == null || s1 == null) {
    return { delta: null, worse: (STATUS_RANK[c1.status] ?? 9) < (STATUS_RANK[c0.status] ?? 9), statusOnly: true }
  }
  return { delta: s1 - s0, worse: s1 - s0 < -0.02, statusOnly: false }
}

function isRegressed(g: CaseGroup, base: string, cand: string | null, metric: string | null): boolean {
  const m = caseMove(g, base, cand, metric)
  return !!m && (m.statusOnly ? m.worse : (m.delta ?? 0) < -0.02)
}

function MoveChip({ mv, metric }: { mv: Move | null; metric: string | null }) {
  if (!mv) return <span className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>—</span>
  if (mv.statusOnly) return <Chip tone={mv.worse ? 'danger' : 'muted'}>{mv.worse ? 'regressed' : 'changed'}</Chip>
  const up = (mv.delta ?? 0) > 0.02
  const down = (mv.delta ?? 0) < -0.02
  const col = down ? 'var(--qw-danger)' : up ? 'var(--qw-ok)' : 'var(--qw-fg-faint)'
  const short = (metric ?? '').slice(0, 3)
  return (
    <span
      title={`${metric} · candidate vs baseline`}
      className="inline-flex items-center gap-[3px] font-mono text-[11px] font-semibold"
      style={{ color: col }}
    >
      {down ? <Icon name="arrowDown" size={11} color={col} strokeWidth={2.4} /> : up ? <Icon name="arrowUp" size={11} color={col} strokeWidth={2.4} /> : <span>=</span>}
      {short} {(mv.delta ?? 0) > 0 ? '+' : ''}
      {(mv.delta ?? 0).toFixed(2)}
    </span>
  )
}

function Seg({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: [string, string, ('danger' | 'ok')?][] }) {
  return (
    <div className="flex gap-1 rounded-[7px] p-0.5" style={{ background: 'var(--qw-bg-muted)' }}>
      {opts.map(([k, label, tone]) => {
        const on = value === k
        return (
          <button
            key={k}
            onClick={() => onChange(k)}
            className="rounded-[5px] px-[11px] py-1 text-[11.5px] font-semibold transition-colors"
            style={{
              background: on ? 'var(--qw-bg-elev)' : 'transparent',
              color: on ? (tone ? `var(--qw-${tone})` : 'var(--qw-fg)') : 'var(--qw-fg-muted)',
              boxShadow: on ? `inset 0 0 0 1px ${tone ? `var(--qw-${tone}-line)` : 'var(--qw-border)'}` : 'none',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function QCells({ exp, onOpenTrace }: { exp: QualityExperimentDetail; onOpenTrace: (traceId: string) => void }) {
  const { base, candidate: cand } = comparisonSides(exp)
  const scoreNames = collectRollupScoreNames(exp)
  const metric = decisiveMetric(exp, scoreNames)
  const primary = scoreNames[0] ?? null
  const variants = exp.variants.map((v) => v.name)

  const all = React.useMemo(
    () => groupCells(exp).slice().sort((a, b) => worstStatus(a) - worstStatus(b)),
    [exp],
  )
  const failingCount = all.filter((g) => worstStatus(g) <= 1).length
  const regressedCount = all.filter((g) => isRegressed(g, base, cand, metric)).length

  const [view, setView] = React.useState<'list' | 'matrix'>('list')
  const [filter, setFilter] = React.useState<'all' | 'regressed' | 'failing'>('all')
  const [open, setOpen] = React.useState<string | null>(() => all.find((g) => worstStatus(g) <= 1)?.caseId ?? null)

  const groups = all.filter((g) =>
    filter === 'all' ? true : filter === 'failing' ? worstStatus(g) <= 1 : isRegressed(g, base, cand, metric),
  )

  return (
    <div>
      <SectionHead
        eyebrow="Cells · failing first"
        right={
          <div className="flex items-center gap-2.5">
            <Seg
              value={filter}
              onChange={(v) => setFilter(v as typeof filter)}
              opts={[
                ['all', `All ${all.length}`],
                ['regressed', `▼ Regressed ${regressedCount}`, 'danger'],
                ['failing', `✕ Failing ${failingCount}`, 'danger'],
              ]}
            />
            <Seg
              value={view}
              onChange={(v) => setView(v as typeof view)}
              opts={[
                ['list', 'list'],
                ['matrix', 'matrix'],
              ]}
            />
          </div>
        }
      />

      {groups.length === 0 ? (
        <div
          className="rounded-[12px] px-7 py-7 text-center text-[12.5px]"
          style={{ border: '1px dashed var(--qw-border)', color: 'var(--qw-fg-muted)' }}
        >
          No cases match this filter.
        </div>
      ) : view === 'matrix' ? (
        <div className="overflow-hidden rounded-[12px]" style={{ border: '1px solid var(--qw-border)', background: 'var(--qw-bg-elev)' }}>
          <div
            className="grid"
            style={{ gridTemplateColumns: `230px 110px repeat(${variants.length}, minmax(0, 1fr))`, borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-bg-muted)' }}
          >
            <div className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--qw-fg-faint)' }}>
              case · {groups.length}
            </div>
            <div
              className="px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em]"
              style={{ color: 'var(--qw-fg-faint)', borderLeft: '1px solid var(--qw-border)' }}
            >
              vs base
            </div>
            {variants.map((vn) => (
              <div key={vn} className="px-4 py-2.5" style={{ borderLeft: '1px solid var(--qw-border)' }}>
                <Chip tone={vn === base ? 'muted' : 'crux'} mono>
                  {vn}
                </Chip>
              </div>
            ))}
          </div>
          {groups.map((grp, gi) => (
            <div
              key={grp.caseId}
              className="grid"
              style={{ gridTemplateColumns: `230px 110px repeat(${variants.length}, minmax(0, 1fr))`, borderBottom: gi === groups.length - 1 ? 'none' : '1px solid var(--qw-border)' }}
            >
              <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3">
                <span className="truncate text-[12.5px] font-medium">{grp.caseName ?? grp.caseId}</span>
                <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  {grp.caseId}
                </span>
              </div>
              <div className="flex items-center px-3 py-3" style={{ borderLeft: '1px solid var(--qw-border)' }}>
                <MoveChip mv={caseMove(grp, base, cand, metric)} metric={metric} />
              </div>
              {variants.map((vn) => {
                const cell = grp.cells[vn]
                const sc = scoreOf(cell, primary)
                const dec = scoreOf(cell, metric)
                return (
                  <div key={vn} className="flex items-center gap-2.5 px-4 py-3" style={{ borderLeft: '1px solid var(--qw-border)' }}>
                    {cell ? <CellStatusChip status={cell.status} showLabel={false} /> : <span style={{ color: 'var(--qw-fg-faint)' }}>—</span>}
                    {sc != null ? (
                      <div className="min-w-0 flex-1">
                        <div className="flex gap-2.5 font-mono text-[11px]">
                          <span>
                            {primary?.slice(0, 4)} <b>{sc.toFixed(2)}</b>
                          </span>
                          {dec != null && metric !== primary && (
                            <span style={{ color: dec < 0.7 ? 'var(--qw-danger)' : 'var(--qw-fg-muted)' }}>
                              {metric?.slice(0, 3)} <b>{dec.toFixed(2)}</b>
                            </span>
                          )}
                        </div>
                        <ErrorBar value={sc} sem={0.05} max={1} width={120} height={12} tone={cell?.status === 'failed' ? 'danger' : undefined} />
                      </div>
                    ) : (
                      <span className="flex-1 font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                        {cell?.status === 'errored' ? cell.error?.phase : '—'}
                      </span>
                    )}
                    {cell?.traceIds[0] && (
                      <button title="open trace" style={{ color: 'var(--qw-fg-faint)' }} onClick={() => onOpenTrace(cell.traceIds[0])}>
                        <Icon name="trace" size={12} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {groups.map((grp) => {
            const isOpen = open === grp.caseId
            const bad = worstStatus(grp) <= 1
            return (
              <div
                key={grp.caseId}
                className="overflow-hidden rounded-[12px]"
                style={{ background: 'var(--qw-bg-elev)', border: `1px solid ${bad ? 'var(--qw-danger-line)' : 'var(--qw-border)'}` }}
              >
                <button
                  onClick={() => setOpen(isOpen ? null : grp.caseId)}
                  className="grid w-full items-center gap-3.5 px-4 py-3 text-left"
                  style={{ gridTemplateColumns: '1fr auto', cursor: 'pointer', background: bad ? 'var(--qw-danger-soft)' : 'transparent' }}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Icon name="arrowRight" size={13} color="var(--qw-fg-faint)" className={isOpen ? 'rotate-90 transition-transform' : 'transition-transform'} />
                    <span className="text-[13px] font-semibold">{grp.caseName ?? grp.caseId}</span>
                    <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                      {grp.caseId}
                    </span>
                    <MoveChip mv={caseMove(grp, base, cand, metric)} metric={metric} />
                  </div>
                  <div className="flex items-center gap-2">
                    {variants.map((vn) => {
                      const cell = grp.cells[vn]
                      return (
                        <div key={vn} className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
                            {vn}
                          </span>
                          {cell ? <CellStatusChip status={cell.status} showLabel={false} /> : <span style={{ color: 'var(--qw-fg-faint)' }}>—</span>}
                        </div>
                      )
                    })}
                  </div>
                </button>
                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--qw-border)' }}>
                    {variants.map((vn) => {
                      const cell = grp.cells[vn]
                      if (!cell) return null
                      return (
                        <div key={vn} style={{ borderBottom: '1px solid var(--qw-border)' }}>
                          <CellEvidenceView
                            experimentId={exp.experimentId}
                            caseId={grp.caseId}
                            variantName={vn}
                            trial={cell.trial}
                            status={cell.status}
                            skipReason={cell.skipReason}
                            onOpenTrace={onOpenTrace}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
