/**
 * Memory route — overview + 4 detail screens (Working / Episodic /
 * Semantic / Blackboard).
 *
 * Visual contract: `v4-library.jsx::V4Memory` (overview) and
 * `v4-library-detail.jsx::V4Memory{Working,Episodic,Semantic,Blackboard}`.
 *
 * Data contract: `/api/memory/stores` and `/api/memory/stores/{id}`,
 * shapes in `types.ts` (`MemoryStore` / `MemoryStoreDetail`).
 *
 * Backend rule honored: missing optional fields = "not captured yet".
 * Columns / chips / cards hide themselves when the underlying field is
 * absent. Never invent zeros or empty rows.
 */

import { useMemo, useState } from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { navTarget } from '@/app/navigation/navTarget'
import { Btn, Chip, Eyebrow, Kpi, SectionHead, Sparkline } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import type { IconName } from '@/qw/shell/nav'
import { useConnected } from '@/app/runtime/runtimeStore'
import { useNavigation } from '@/app/navigation/useNavigation'
import {
  useMemoryOperations,
  useMemoryStoreDetails,
  useMemoryStoreSuspense,
} from '@/shared/hooks/useLibraryApi'
import {
  fmtCount,
  fmtDuration,
  fmtRelative,
  fmtTime,
  fmtValue,
  healthTone,
  parseLiveFields,
  scoreTone,
  shortBreadcrumbId,
  shortTrace,
  typeMeta,
  type LiveField,
} from '@/features/memory/lib/memory-format'
import {
  EmptyHint,
  EmptyInline,
  ErrorBanner,
  LDCard,
  LDHeaderStrip,
  LDKV,
  LDOpPill,
  MemoryCardTabs,
  MemoryInspectionNotice,
  Stat,
  TableHeader,
} from './MemoryAtoms'
import { Tabs, TabsContent } from '@/shared/components/ui/tabs'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonCard, SkeletonRows } from '@/shared/components/Skeleton'
import { qk } from '@/shared/query/queryClient'
import { usePrefetchMemoryStore } from '@/shared/hooks/usePrefetch'
import { useMemoryStoresSuspense } from '@/shared/hooks/useLibraryApi'
import { SchemaCard } from './MemorySchema'
import { DefinitionBindingCard } from './MemoryBinding'
import { WorkingDetail } from './MemoryWorkingDetail'
import { EpisodicDetail } from './MemoryEpisodicDetail'
import { OperationHistoryTable, SpotlightEpisodic, SpotlightWorking, StoreCard } from './MemoryOverviewPanels'
import type {
  MemoryBlackboardChange,
  MemoryBlackboardField,
  MemoryBlackboardState,
  MemoryEpisodicEntry,
  MemoryEpisodicQuery,
  MemoryEpisodicState,
  MemoryEpisodicWrite,
  MemoryOperationRecord,
  MemorySemanticChunk,
  MemorySemanticQuery,
  MemorySemanticState,
  MemoryStore,
  MemoryStoreDetail,
  MemoryStoreType,
  MemoryWorkingField,
  MemoryWorkingMutation,
  MemoryWorkingState,
} from '@/types'

// ─── Router ─────────────────────────────────────────────────────────

export function MemoryView({ memoryId }: { memoryId?: string }) {
  if (memoryId) return <MemoryDetail storeId={memoryId} />
  return <MemoryOverview />
}

// ─── Overview ───────────────────────────────────────────────────────

type TypeFilter = 'all' | MemoryStoreType

function MemoryOverview() {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const prefetchStore = usePrefetchMemoryStore()
  // Suspends on first paint — caught by the App-level Suspense. List
  // hooks below (parallel store details, operations) are kept on the
  // non-suspense path because they fan out and we don't want N parallel
  // suspensions blocking the whole screen.
  const list = useMemoryStoresSuspense()
  const [filter, setFilter] = useState<TypeFilter>('all')

  // Fetch all store details in parallel — feeds the spotlight panels
  // and the cross-store Operation history. Cache is shared with
  // `useMemoryStore` so detail-page navigation is a cache hit.
  const detailQueries = useMemoryStoreDetails(list.map((s) => s.id))
  const details = useMemo(
    () => detailQueries.map((q) => q.data).filter((d): d is MemoryStoreDetail => Boolean(d)),
    [detailQueries],
  )

  const kpis = useMemo(() => {
    let reads = 0
    let writes = 0
    let conflicts = 0
    let carryEntries = 0
    const byType: Partial<Record<MemoryStoreType, number>> = {}
    let readsTrend: number[] | null = null
    let writesTrend: number[] | null = null
    for (const s of list) {
      reads += s.stats?.reads ?? 0
      writes += s.stats?.writes ?? 0
      conflicts += s.stats?.conflicts ?? 0
      if (s.type === 'episodic') carryEntries += s.stats?.entries ?? 0
      byType[s.type as MemoryStoreType] = (byType[s.type as MemoryStoreType] ?? 0) + 1
      // Per-bucket sum across stores so the KPI sparkline reflects the
      // *aggregate* trend, not any single store.
      const tr = s.stats?.trend?.reads
      const tw = s.stats?.trend?.writes
      if (tr) {
        if (!readsTrend) readsTrend = Array.from({ length: tr.length }, () => 0)
        for (let i = 0; i < tr.length && i < readsTrend.length; i++) readsTrend[i] += tr[i] ?? 0
      }
      if (tw) {
        if (!writesTrend) writesTrend = Array.from({ length: tw.length }, () => 0)
        for (let i = 0; i < tw.length && i < writesTrend.length; i++) writesTrend[i] += tw[i] ?? 0
      }
    }
    return { reads, writes, conflicts, carryEntries, byType, readsTrend, writesTrend }
  }, [list])

  const filtered = useMemo(() => (filter === 'all' ? list : list.filter((s) => s.type === filter)), [list, filter])

  // Spotlight: pick the most recently touched store per type
  const spotlight = useMemo(() => {
    const byType = new Map<MemoryStoreType, MemoryStoreDetail>()
    for (const d of details) {
      const prev = byType.get(d.type as MemoryStoreType)
      const ts = d.stats?.lifetime?.lastTouchedAt ?? 0
      const prevTs = prev?.stats?.lifetime?.lastTouchedAt ?? -1
      if (!prev || ts > prevTs) byType.set(d.type as MemoryStoreType, d)
    }
    return {
      working: byType.get('working'),
      episodic: byType.get('episodic'),
      semantic: byType.get('semantic'),
      blackboard: byType.get('blackboard'),
    }
  }, [details])

  // Cross-store operations: server-side merge via /api/memory/operations.
  const { data: opsData } = useMemoryOperations({ limit: 50 })
  const operations = useMemo<readonly MemoryOperationRecord[]>(() => opsData ?? [], [opsData])

  return (
    <QwShell
      activeView="library-memory"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Library / Memory"
      title="Memory"
      subtitle={
        list.length === 0
          ? 'No memory stores observed yet'
          : `${list.length} store${list.length === 1 ? '' : 's'} · ${kpis.reads.toLocaleString()} reads · ${kpis.writes.toLocaleString()} writes`
      }
      connected={connected}
      actions={
        <>
          <Btn
            size="sm"
            icon={<Icon name="loop" size={11} />}
            disabled
            title="Tail live — backend wiring not yet shipped"
          >
            Tail live
          </Btn>
          <Btn
            size="sm"
            variant="outline"
            icon={<Icon name="arrowDown" size={11} />}
            disabled
            title="Export ops — backend wiring not yet shipped"
          >
            Export ops
          </Btn>
        </>
      }
      tabs={[
        { label: 'All', count: list.length, active: filter === 'all', onClick: () => setFilter('all') },
        ...(kpis.byType.working
          ? [
              {
                label: 'Working',
                count: kpis.byType.working,
                iconName: 'brain' as const,
                active: filter === 'working',
                onClick: () => setFilter('working'),
              },
            ]
          : []),
        ...(kpis.byType.episodic
          ? [
              {
                label: 'Episodic',
                count: kpis.byType.episodic,
                iconName: 'book' as const,
                active: filter === 'episodic',
                onClick: () => setFilter('episodic'),
              },
            ]
          : []),
        ...(kpis.byType.semantic
          ? [
              {
                label: 'Semantic',
                count: kpis.byType.semantic,
                iconName: 'db' as const,
                active: filter === 'semantic',
                onClick: () => setFilter('semantic'),
              },
            ]
          : []),
        ...(kpis.byType.blackboard
          ? [
              {
                label: 'Blackboard',
                count: kpis.byType.blackboard,
                iconName: 'grid' as const,
                active: filter === 'blackboard',
                onClick: () => setFilter('blackboard'),
              },
            ]
          : []),
      ]}
    >
      <div className="mx-auto w-full max-w-7xl px-8 py-6">

        <div className="mb-5 grid grid-cols-4 gap-3">
          <Kpi
            label="Active stores"
            value={String(list.length)}
            sublabel={
              [
                kpis.byType.working ? `${kpis.byType.working} working` : null,
                kpis.byType.episodic ? `${kpis.byType.episodic} episodic` : null,
                kpis.byType.semantic ? `${kpis.byType.semantic} semantic` : null,
                kpis.byType.blackboard ? `${kpis.byType.blackboard} blackboard` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'none'
            }
          />
          <Kpi label="Reads · all stores" value={kpis.reads.toLocaleString()} trend={kpis.readsTrend ?? undefined} />
          <Kpi
            label="Writes · all stores"
            value={kpis.writes.toLocaleString()}
            trend={kpis.writesTrend ?? undefined}
            sublabel={
              kpis.conflicts > 0 ? `${kpis.conflicts} conflict${kpis.conflicts === 1 ? '' : 's'}` : '0 conflicts'
            }
          />
          <Kpi
            label="Carry-forward"
            value={kpis.carryEntries > 0 ? kpis.carryEntries.toLocaleString() : '—'}
            sublabel="episodic entries across runs"
          />
        </div>

        <SectionHead
          eyebrow="Memory stores"
          right={
            <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {filtered.length} of {list.length}
            </span>
          }
        />

        {filtered.length === 0 ? (
          <EmptyHint>
            {filter === 'all'
              ? 'No memory stores have been observed yet. They appear here as soon as your app reads or writes any memory primitive.'
              : `No ${filter} memory stores observed yet.`}
          </EmptyHint>
        ) : (
          <SectionBoundary title="Memory store grid" fallback={
            <div className="mb-6 grid grid-cols-2 gap-3">
              <SkeletonCard bodyLines={4} />
              <SkeletonCard bodyLines={4} />
            </div>
          }>
          <div className="mb-6 grid grid-cols-2 gap-3">
            {filtered.map((s) => (
              <StoreCard
                key={s.id}
                store={s}
                onOpen={() => navigate({ view: 'library-memory', memoryId: s.id })}
                onHover={() => prefetchStore(s.id)}
              />
            ))}
          </div>
          </SectionBoundary>
        )}

        {filter === 'all' && (spotlight.working || spotlight.episodic) && (
          <div className="mb-6 grid gap-4" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
            <SpotlightWorking
              store={spotlight.working}
              onOpen={(id) => navigate({ view: 'library-memory', memoryId: id })}
            />
            <SpotlightEpisodic
              store={spotlight.episodic}
              onOpen={(id) => navigate({ view: 'library-memory', memoryId: id })}
            />
          </div>
        )}

        {operations.length > 0 && (
          <OperationHistoryTable
            operations={operations}
            onOpen={(id) => navigate({ view: 'library-memory', memoryId: id })}
          />
        )}
      </div>
    </QwShell>
  )
}

// ─── Detail router ──────────────────────────────────────────────────

function MemoryDetail({ storeId }: { storeId: string }) {
  const { navigate } = useNavigation()
  const connected = useConnected()
  // Suspends on first paint — caught by the App-level Suspense.
  // Errors throw to the App-level ErrorBoundary.
  const data = useMemoryStoreSuspense(storeId)
  const m = typeMeta(data.type)

  return (
    <QwShell
      activeView="library-memory"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb={`Library / Memory / ${shortBreadcrumbId(storeId)}`}
      title={`${m.label.charAt(0).toUpperCase() + m.label.slice(1)} memory`}
      subtitle={subtitleFor(data)}
      connected={connected}
      actions={
        <>
          <Btn variant="ghost" size="sm" onClick={() => navigate({ view: 'library-memory' })}>
            ← All stores
          </Btn>
          <Btn
            size="sm"
            icon={<Icon name="loop" size={11} />}
            disabled
            title="Tail live — backend wiring not yet shipped"
          >
            Tail live
          </Btn>
          {data.state.type === 'working' && (
            <Btn
              size="sm"
              icon={<Icon name="diff" size={11} />}
              disabled
              title="Diff vs another run — backend wiring not yet shipped"
            >
              Diff
            </Btn>
          )}
          {data.state.type === 'semantic' && (
            <Btn
              size="sm"
              icon={<Icon name="loop" size={11} />}
              disabled
              title="Re-ingest — backend wiring not yet shipped"
            >
              Re-ingest
            </Btn>
          )}
          {data.state.type === 'blackboard' && (
            <Btn
              size="sm"
              icon={<Icon name="diff" size={11} />}
              disabled
              title="Show conflicts — backend wiring not yet shipped"
            >
              Show conflicts
            </Btn>
          )}
          <Btn
            size="sm"
            variant="outline"
            icon={<Icon name="arrowDown" size={11} />}
            disabled
            title="Export — backend wiring not yet shipped"
          >
            Export
          </Btn>
        </>
      }
    >
      <div className="mx-auto w-full max-w-7xl px-8 py-6">
        <DetailBody store={data} />
      </div>
    </QwShell>
  )
}

function subtitleFor(s: MemoryStoreDetail): string {
  const scope = s.scope?.kind
    ? `${s.scope.kind}${s.scope.id ? ` · ${s.scope.id.length > 14 ? s.scope.id.slice(0, 14) + '…' : s.scope.id}` : ''}`
    : '—'
  const lifetime = s.stats?.lifetime?.lastTouchedAt
    ? `last touched ${fmtRelative(s.stats.lifetime.lastTouchedAt)}`
    : null
  return [scope, lifetime].filter(Boolean).join(' · ')
}

function DetailBody({ store }: { store: MemoryStoreDetail }) {
  return (
    <>
      {store.inspection && <MemoryInspectionNotice inspection={store.inspection} />}
      <DetailBodyInner store={store} />
    </>
  )
}

function DetailBodyInner({ store }: { store: MemoryStoreDetail }) {
  switch (store.state.type) {
    case 'working':
      return <WorkingDetail store={store} state={store.state} />
    case 'episodic':
      return <EpisodicDetail store={store} state={store.state} />
    case 'semantic':
      return <SemanticDetail store={store} state={store.state} />
    case 'blackboard':
      return <BlackboardDetail store={store} state={store.state} />
    default:
      return <EmptyHint>Unknown memory type: {(store.state as { type: string }).type}</EmptyHint>
  }
}

// ─── Episodic detail ────────────────────────────────────────────────

// ─── Semantic detail ────────────────────────────────────────────────

function SemanticDetail({ store, state }: { store: MemoryStoreDetail; state: MemorySemanticState }) {
  const m = typeMeta('semantic')
  const chunks = state.chunks ?? []
  const queries = state.queries ?? []
  const index = state.index

  const avgTop = useMemo(() => {
    const withTop = queries.filter((q) => typeof q.topScore === 'number')
    if (withTop.length === 0) return null
    return withTop.reduce((a, q) => a + (q.topScore ?? 0), 0) / withTop.length
  }, [queries])

  const topSources = useMemo(() => {
    const m2 = new Map<string, number>()
    for (const c of chunks) {
      m2.set(c.sourceDoc, (m2.get(c.sourceDoc) ?? 0) + 1)
    }
    return Array.from(m2.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
  }, [chunks])

  return (
    <>
      <LDHeaderStrip
        icon={m.icon}
        color={m.color}
        id={store.id}
        chips={
          <>
            <Chip tone={m.tone} mono>
              {m.label}
            </Chip>
            <Chip tone={healthTone(store.health)} dot>
              {store.health}
            </Chip>
            {(index?.similarity || index?.dimensions) && (
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {index?.similarity ?? '—'}
                {index?.dimensions ? ` · ${index.dimensions}d` : ''}
              </span>
            )}
          </>
        }
        stats={[
          { label: 'Chunks', value: fmtCount(index?.chunkCount ?? chunks.length) },
          { label: 'Sources', value: fmtCount(index?.sourceCount ?? topSources.length) },
          { label: 'Queries', value: queries.length },
          ...(avgTop != null ? [{ label: 'Avg top', value: avgTop.toFixed(2), color: scoreTone(avgTop) }] : []),
          { label: 'Reads', value: store.stats?.reads ?? '—' },
        ]}
        right={
          index?.embeddingModel ? (
            <Chip tone="ok" mono>
              {index.embeddingModel}
            </Chip>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-4" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <LDCard
          title="Index entries"
          color={m.color}
          right={
            <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {chunks.length} of {index?.chunkCount ?? chunks.length}
            </span>
          }
        >
          {chunks.length === 0 ? (
            <EmptyInline>No chunks captured yet.</EmptyInline>
          ) : (
            chunks.map((c, i) => <SemanticChunkRow key={c.id} chunk={c} last={i === chunks.length - 1} />)
          )}
        </LDCard>

        <div className="flex flex-col gap-3.5">
          <LDCard title="Index stats" color={m.color} padding="12px 14px">
            <div className="flex flex-col gap-2">
              {[
                ['Embedding', index?.embeddingModel ?? '—'],
                ['Dimensions', index?.dimensions != null ? String(index.dimensions) : '—'],
                ['Distance', index?.similarity ?? '—'],
                ['Chunks', fmtCount(index?.chunkCount ?? null)],
                ['Sources', fmtCount(index?.sourceCount ?? null)],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3 font-mono text-[11.5px]">
                  <span style={{ color: 'var(--qw-fg-faint)', minWidth: 100 }}>{k}</span>
                  <span style={{ color: v === '—' ? 'var(--qw-fg-faint)' : 'var(--qw-fg)' }}>{v}</span>
                </div>
              ))}
            </div>
          </LDCard>

          <LDCard title={`Source documents · top ${topSources.length}`} padding="12px 14px">
            {topSources.length === 0 ? (
              <EmptyInline>No sources captured.</EmptyInline>
            ) : (
              <div className="flex flex-col gap-1.5">
                {topSources.map(([doc, n]) => (
                  <div
                    key={doc}
                    className="grid items-center gap-2.5"
                    style={{ gridTemplateColumns: 'minmax(0, 1fr) 60px' }}
                  >
                    <span className="truncate font-mono text-[11.5px]" style={{ color: 'var(--qw-fg)' }} title={doc}>
                      {doc}
                    </span>
                    <span className="text-right font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                      {n} chunk{n === 1 ? '' : 's'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </LDCard>

          <SchemaCard schema={store.schema} color={m.color} authoringHint="semanticMemory({ chunk })" />
          <DefinitionBindingCard store={store} />
        </div>
      </div>

      <SemanticQueryLog queries={queries} />
    </>
  )
}

function SemanticChunkRow({ chunk, last }: { chunk: MemorySemanticChunk; last: boolean }) {
  return (
    <div className="px-4 py-3" style={{ borderBottom: last ? 'none' : '1px solid var(--qw-border)' }}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px]" style={{ color: 'var(--qw-crux)' }}>
          {chunk.id}
        </span>
        <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          § {chunk.sourceDoc}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {chunk.tags?.map((t) => (
            <Chip key={t} tone="muted">
              {t}
            </Chip>
          ))}
          {chunk.magnitude != null && (
            <span
              className="rounded-[3px] px-1.5 py-[1px] font-mono text-[10.5px]"
              style={{
                background: 'var(--qw-bg-muted)',
                color: 'var(--qw-fg-muted)',
              }}
            >
              ‖embed‖ {chunk.magnitude.toFixed(2)}
            </span>
          )}
        </span>
      </div>
      <div
        className="text-[13px] leading-[1.55]"
        style={{ fontFamily: 'var(--qw-serif, Georgia, serif)', color: 'var(--qw-fg)' }}
      >
        {chunk.text}
      </div>
    </div>
  )
}

function SemanticQueryLog({ queries }: { queries: readonly MemorySemanticQuery[] }) {
  if (queries.length === 0) {
    return (
      <section>
        <SectionHead eyebrow="Query log" />
        <EmptyHint>No queries captured yet.</EmptyHint>
      </section>
    )
  }
  const hasHits = queries.some((q) => q.hitChunkIds && q.hitChunkIds.length > 0)
  const hasLat = queries.some((q) => q.latencyMs != null)
  const hasTrace = queries.some((q) => q.traceId)
  return (
    <section>
      <SectionHead
        eyebrow="Query log"
        right={
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {queries.length} {queries.length === 1 ? 'query' : 'queries'}
          </span>
        }
      />
      <div
        className="overflow-hidden rounded-[10px]"
        style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
      >
        <TableHeader
          cols={[
            { label: 'time', width: '70px' },
            { label: 'query', width: 'minmax(0, 1fr)' },
            { label: 'k', width: '36px', align: 'right' },
            { label: 'top', width: '60px', align: 'right' },
            ...(hasHits ? [{ label: 'top hits', width: 'minmax(0, 1fr)' }] : []),
            ...(hasLat ? [{ label: 'lat', width: '60px', align: 'right' as const }] : []),
            ...(hasTrace ? [{ label: 'trace', width: '70px', align: 'right' as const }] : []),
          ]}
        />
        {queries.map((q, i) => (
          <div
            key={q.eventId}
            className="grid items-center gap-2.5 px-4 py-2.5 font-mono text-[11.5px]"
            style={{
              gridTemplateColumns: [
                '70px',
                'minmax(0, 1fr)',
                '36px',
                '60px',
                hasHits ? 'minmax(0, 1fr)' : '',
                hasLat ? '60px' : '',
                hasTrace ? '70px' : '',
              ]
                .filter(Boolean)
                .join(' '),
              borderBottom: i === queries.length - 1 ? 'none' : '1px solid var(--qw-border)',
            }}
          >
            <span style={{ color: 'var(--qw-fg-faint)' }}>{fmtTime(q.timestamp)}</span>
            <span className="truncate" style={{ color: 'var(--qw-fg)' }} title={q.query}>
              {q.query}
            </span>
            <span className="text-right" style={{ color: 'var(--qw-fg-muted)' }}>
              {q.k ?? '—'}
            </span>
            <span className="text-right font-semibold" style={{ color: scoreTone(q.topScore) }}>
              {q.topScore?.toFixed(2) ?? '—'}
            </span>
            {hasHits && (
              <span className="flex min-w-0 flex-wrap gap-1">
                {q.hitChunkIds?.slice(0, 3).map((h) => (
                  <span
                    key={h}
                    className="rounded-[3px] px-1.5 py-[1px] text-[10px]"
                    style={{
                      background: 'var(--qw-crux-soft)',
                      color: 'var(--qw-crux)',
                    }}
                  >
                    {h}
                  </span>
                ))}
              </span>
            )}
            {hasLat && (
              <span className="text-right" style={{ color: 'var(--qw-fg-faint)' }}>
                {q.latencyMs != null ? `${q.latencyMs}ms` : '—'}
              </span>
            )}
            {hasTrace && (
              <span className="text-right" style={{ color: 'var(--qw-crux)' }}>
                {shortTrace(q.traceId) ?? '—'}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// ─── Blackboard detail ──────────────────────────────────────────────

type BlackboardTab = 'live' | 'conflicts'

function BlackboardDetail({ store, state }: { store: MemoryStoreDetail; state: MemoryBlackboardState }) {
  const m = typeMeta('blackboard')
  const fields = state.fields ?? []
  const log = state.changeLog ?? []
  const collaborators = state.collaborators ?? []
  const totalConflicts = fields.reduce((a, f) => a + (f.conflicts ?? 0), 0)
  const conflictFields = useMemo(() => fields.filter((f) => (f.conflicts ?? 0) > 0), [fields])

  // Live runtime fields, parsed from inspection.entries when the bridge is
  // up. When present, we merge each live value onto the matching projected
  // field row (preserves writer/writtenAt/conflicts so the table stays
  // honest) and prepend any live-only keys at the bottom.
  const liveFields = useMemo(() => parseLiveFields(store.inspection), [store.inspection])
  const mergedLiveFields = useMemo<readonly MemoryBlackboardField[] | null>(() => {
    if (!liveFields) return null
    const byName = new Map(fields.map((f) => [f.name, f]))
    const seen = new Set<string>()
    const out: MemoryBlackboardField[] = []
    for (const lf of liveFields) {
      const projected = byName.get(lf.name)
      seen.add(lf.name)
      out.push({
        ...(projected ?? {}),
        name: lf.name,
        ty: projected?.ty ?? lf.ty,
        value: lf.value,
        writtenAt: lf.writtenAt ?? projected?.writtenAt,
      } as MemoryBlackboardField)
    }
    for (const f of fields) {
      if (!seen.has(f.name)) out.push(f)
    }
    return out
  }, [liveFields, fields])

  // Conflicts is hidden when the projection has no per-field conflict data.
  // Today the backend ships fields with only {name, ty, value, writtenAt} —
  // never `conflicts` — so the tab will surface as soon as it does.
  const hasConflicts = conflictFields.length > 0
  const liveFields4Display = mergedLiveFields ?? fields
  const [tab, setTab] = useState<BlackboardTab>('live')

  // Per-agent rollup from change log
  const perAgent = useMemo(() => {
    const map = new Map<string, { writes: number; conflicts: number }>()
    for (const c of log) {
      if (!c.agent) continue
      const row = map.get(c.agent) ?? { writes: 0, conflicts: 0 }
      row.writes++
      if (c.resolved) row.conflicts++
      map.set(c.agent, row)
    }
    for (const a of collaborators) {
      if (!map.has(a)) map.set(a, { writes: 0, conflicts: 0 })
    }
    return Array.from(map.entries())
  }, [log, collaborators])

  return (
    <>
      <LDHeaderStrip
        icon={m.icon}
        color={m.color}
        id={store.id}
        chips={
          <>
            <Chip tone={m.tone} mono>
              {m.label}
            </Chip>
            {totalConflicts > 0 ? (
              <Chip tone="warn" dot>
                {totalConflicts} conflict{totalConflicts === 1 ? '' : 's'} resolved
              </Chip>
            ) : (
              <Chip tone={healthTone(store.health)} dot>
                {store.health}
              </Chip>
            )}
            {store.scope && (
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {store.scope.kind} · {shortTrace(store.scope.id) ?? store.scope.id}
              </span>
            )}
          </>
        }
        stats={[
          { label: 'Fields', value: fields.length },
          { label: 'Writes', value: log.length || store.stats?.writes || 0 },
          { label: 'Reads', value: store.stats?.reads ?? '—' },
          {
            label: 'Conflicts',
            value: totalConflicts,
            color: totalConflicts > 0 ? 'var(--qw-warn)' : 'var(--qw-fg-faint)',
          },
          { label: 'Collaborators', value: perAgent.length || '—' },
          ...(state.conflictPolicy
            ? [{ label: 'Conflict policy', value: state.conflictPolicy, color: 'var(--qw-fg-muted)' }]
            : []),
        ]}
        right={
          collaborators.length > 0 ? (
            <>
              {collaborators.slice(0, 4).map((c, i) => (
                <Chip key={c} tone={i % 2 === 0 ? 'iris' : 'ok'} mono>
                  {c}
                </Chip>
              ))}
            </>
          ) : undefined
        }
      />

      <div className="mb-5 grid gap-4" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        {hasConflicts ? (
          <Tabs value={tab} onValueChange={(v) => setTab(v as BlackboardTab)}>
            <LDCard
              title="Current fields"
              color={m.color}
              right={
                <MemoryCardTabs
                  tabs={[
                    { value: 'live', label: 'Live', count: liveFields4Display.length },
                    { value: 'conflicts', label: 'Conflicts', count: totalConflicts },
                  ]}
                />
              }
            >
              <TabsContent value="live" className="m-0">
                {liveFields4Display.length === 0 ? (
                  <EmptyInline>No fields captured yet.</EmptyInline>
                ) : (
                  <BlackboardFieldTable fields={liveFields4Display} />
                )}
              </TabsContent>
              <TabsContent value="conflicts" className="m-0">
                <BlackboardFieldTable fields={conflictFields} />
              </TabsContent>
            </LDCard>
          </Tabs>
        ) : (
          <LDCard title="Current fields" color={m.color}>
            {liveFields4Display.length === 0 ? (
              <EmptyInline>No fields captured yet.</EmptyInline>
            ) : (
              <BlackboardFieldTable fields={liveFields4Display} />
            )}
          </LDCard>
        )}

        <div className="flex flex-col gap-3.5">
          <SchemaCard
            schema={store.schema}
            inferredFields={fields.map((f) => ({ name: f.name, ty: f.ty }))}
            color={m.color}
            authoringHint="blackboard({ schema })"
          />

          {perAgent.length > 0 && (
            <LDCard title="Collaborators" padding="12px 14px">
              {perAgent.map(([agent, row]) => (
                <div
                  key={agent}
                  className="grid items-baseline gap-2.5 py-1 font-mono text-[11.5px]"
                  style={{ gridTemplateColumns: '110px repeat(2, minmax(0, 1fr))' }}
                >
                  <span style={{ color: 'var(--qw-iris)' }}>{agent}</span>
                  <span style={{ color: 'var(--qw-fg-muted)' }}>w {row.writes}</span>
                  <span
                    style={{
                      color: row.conflicts > 0 ? 'var(--qw-warn)' : 'var(--qw-fg-faint)',
                    }}
                  >
                    !{row.conflicts}
                  </span>
                </div>
              ))}
            </LDCard>
          )}

          <DefinitionBindingCard store={store} />
        </div>
      </div>

      <BlackboardChangeLog log={log} />
    </>
  )
}

function BlackboardFieldTable({ fields }: { fields: readonly MemoryBlackboardField[] }) {
  const hasWriter = fields.some((f) => f.writer)
  const hasWrittenAt = fields.some((f) => f.writtenAt)
  return (
    <>
      <TableHeader
        cols={[
          { label: 'field', width: '170px' },
          { label: 'type', width: '110px' },
          { label: 'value', width: 'minmax(0, 1fr)' },
          ...(hasWriter ? [{ label: 'writer', width: '110px' }] : []),
          ...(hasWrittenAt ? [{ label: 'at', width: '70px', align: 'right' as const }] : []),
        ]}
      />
      {fields.map((f, i) => (
        <div
          key={f.name}
          className="grid items-baseline gap-2.5 px-3.5 py-2.5 font-mono text-[11.5px]"
          style={{
            gridTemplateColumns: [
              '170px',
              '110px',
              'minmax(0, 1fr)',
              hasWriter ? '110px' : '',
              hasWrittenAt ? '70px' : '',
            ]
              .filter(Boolean)
              .join(' '),
            borderBottom: i === fields.length - 1 ? 'none' : '1px solid var(--qw-border)',
            background: (f.conflicts ?? 0) > 0 ? 'var(--qw-warn-soft)' : 'transparent',
          }}
        >
          <span style={{ color: 'var(--qw-crux)' }}>{f.name}</span>
          <span className="text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {f.ty}
          </span>
          <span className="truncate" style={{ color: 'var(--qw-fg)' }} title={fmtValue(f.value)}>
            {fmtValue(f.value)}
            {f.lastConflictResolution && (
              <span className="ml-2 text-[10px]" style={{ color: 'var(--qw-warn)' }}>
                · {f.lastConflictResolution}
              </span>
            )}
          </span>
          {hasWriter && <span style={{ color: 'var(--qw-fg-muted)' }}>{f.writer ?? '—'}</span>}
          {hasWrittenAt && (
            <span className="text-right text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {fmtTime(f.writtenAt) ?? '—'}
            </span>
          )}
        </div>
      ))}
    </>
  )
}

function BlackboardChangeLog({ log }: { log: readonly MemoryBlackboardChange[] }) {
  if (log.length === 0) {
    return (
      <section>
        <SectionHead eyebrow="Change log" />
        <EmptyHint>No changes captured yet.</EmptyHint>
      </section>
    )
  }
  const hasResolved = log.some((l) => l.resolved)
  const hasAgent = log.some((l) => l.agent)
  return (
    <section>
      <SectionHead
        eyebrow="Change log"
        right={
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {log.length} writes{hasResolved ? ' · conflicts highlighted' : ''}
          </span>
        }
      />
      <div
        className="overflow-hidden rounded-[10px]"
        style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
      >
        <TableHeader
          cols={[
            { label: 'time', width: '70px' },
            ...(hasAgent ? [{ label: 'agent', width: '110px' }] : []),
            { label: 'field', width: '170px' },
            { label: 'before', width: 'minmax(0, 1fr)' },
            { label: 'after', width: 'minmax(0, 1fr)' },
            ...(hasResolved ? [{ label: 'resolution', width: 'minmax(0, 1.4fr)' }] : []),
          ]}
        />
        {log.map((l, i) => (
          <div
            key={l.eventId}
            className="grid items-center gap-2.5 px-4 py-2.5 font-mono text-[11.5px]"
            style={{
              gridTemplateColumns: [
                '70px',
                hasAgent ? '110px' : '',
                '170px',
                'minmax(0, 1fr)',
                'minmax(0, 1fr)',
                hasResolved ? 'minmax(0, 1.4fr)' : '',
              ]
                .filter(Boolean)
                .join(' '),
              borderBottom: i === log.length - 1 ? 'none' : '1px solid var(--qw-border)',
              background: l.resolved ? 'var(--qw-warn-soft)' : 'transparent',
            }}
          >
            <span style={{ color: 'var(--qw-fg-faint)' }}>{fmtTime(l.timestamp)}</span>
            {hasAgent && <span style={{ color: 'var(--qw-fg)' }}>{l.agent ?? '—'}</span>}
            <span style={{ color: 'var(--qw-crux)' }}>{l.field}</span>
            <span className="truncate" style={{ color: 'var(--qw-fg-muted)' }} title={fmtValue(l.before)}>
              {fmtValue(l.before)}
            </span>
            <span className="truncate" style={{ color: 'var(--qw-fg)' }} title={fmtValue(l.after)}>
              {fmtValue(l.after)}
            </span>
            {hasResolved && (
              <span className="text-[10.5px]" style={{ color: l.resolved ? 'var(--qw-warn)' : 'var(--qw-fg-faint)' }}>
                {l.resolved ?? '—'}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// Silence unused imports — kept for future use.
void Sparkline
void Eyebrow
