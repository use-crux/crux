import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Streamdown } from 'streamdown'
import { Chip, SectionHead } from '@/qw/shell/primitives'
import { useNavigation } from '@/app/navigation/useNavigation'
import { fmtRelative, fmtTime, healthTone, scoreTone, shortTrace, typeMeta } from '@/features/memory/lib/memory-format'
import { Tabs, TabsContent } from '@/shared/components/ui/tabs'
import { DefinitionBindingCard } from './MemoryBinding'
import { EmptyInline, LDCard, LDHeaderStrip, LDOpPill, MemoryCardTabs, TableHeader } from './MemoryAtoms'
import type { MemoryTabSpec } from './MemoryAtoms'
import { SchemaCard } from './MemorySchema'
import type {
  MemoryEpisodicEntry,
  MemoryEpisodicQuery,
  MemoryEpisodicState,
  MemoryEpisodicWrite,
  MemoryStoreDetail,
} from '@/types'

type ColDef = { label: string; width: string; align?: 'left' | 'right' }

/**
 * Episodic entry ids are fully-namespaced store keys
 * (`memory:…:block:episodes:episode_123_ab`). Show the trailing segment for
 * readability — the full key stays available on hover via `title`.
 */
function shortEntryId(id: string): string {
  const segment = id.slice(id.lastIndexOf(':') + 1)
  return segment || id
}

/**
 * Run / trace ids resolve to the run-detail view. In this devtools the
 * run-detail route is keyed by trace id, which equals the run id (see
 * `run-mappers`/`GlobalSearch`), so both `sourceRun` and `traceId` link here.
 * Renders as an inline link; the full id stays on hover.
 */
function RunLink({ id, label }: { id: string; label?: string }) {
  const { navigate } = useNavigation()
  return (
    <button
      type="button"
      onClick={() => navigate({ view: 'run-detail', traceId: id })}
      className="underline-offset-2 hover:underline"
      style={{ color: 'var(--qw-crux)' }}
      title={id}
    >
      {label ?? shortTrace(id) ?? id}
    </button>
  )
}

export function EpisodicDetail({ store, state }: { store: MemoryStoreDetail; state: MemoryEpisodicState }) {
  const m = typeMeta('episodic')
  const entries = state.entries ?? []
  const queries = state.queries ?? []
  const writes = state.writes ?? []

  // Confidence is absent for recency stores — `avgConf` stays null and the stat
  // hides rather than rendering an empty "—".
  const avgConf = useMemo(() => {
    const withConf = entries.filter((e) => typeof e.confidence === 'number')
    if (withConf.length === 0) return null
    return withConf.reduce((a, e) => a + (e.confidence ?? 0), 0) / withConf.length
  }, [entries])

  // Provenance is the rich story here: how many distinct subsystems wrote episodes.
  const sourceCount = useMemo(() => new Set(entries.map((e) => e.writtenBy).filter(Boolean)).size, [entries])

  const retentionPolicy = state.retention?.policy
  const embeddingModel = state.index?.embeddingModel

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
            {store.scope && (
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {store.scope.kind} · {shortTrace(store.scope.id) ?? store.scope.id}
              </span>
            )}
          </>
        }
        stats={[
          { label: 'Entries', value: store.stats?.entries ?? entries.length },
          { label: 'Queries', value: queries.length },
          { label: 'Writes', value: writes.length },
          ...(avgConf != null ? [{ label: 'Avg conf.', value: avgConf.toFixed(2), color: scoreTone(avgConf) }] : []),
          ...(sourceCount > 0 ? [{ label: 'Sources', value: sourceCount }] : []),
          ...(retentionPolicy ? [{ label: 'Retention', value: retentionPolicy }] : []),
          ...(embeddingModel ? [{ label: 'Embedding', value: embeddingModel, color: 'var(--qw-fg-muted)' }] : []),
        ]}
        right={
          store.scope && (
            <>
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                scope
              </span>
              <Chip tone={m.tone} mono>
                {store.scope.kind} · {shortTrace(store.scope.id) ?? store.scope.id}
              </Chip>
            </>
          )
        }
      />

      <div className="mb-5 grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
        <div className="min-w-0">
          <EpisodicEntries entries={entries} color={m.color} />
        </div>

        <div className="flex min-w-0 flex-col gap-3.5">
          {/* Canonical EpisodicEntry schema is attached server-side for all episodic
              stores — no per-project authoring step, so no authoring hint. */}
          <SchemaCard schema={store.schema} color={m.color} />
          <EpisodicIndexCard index={state.index} />
          <EpisodicRetentionCard retention={state.retention} />
          <DefinitionBindingCard store={store} />
        </div>
      </div>

      <SectionHead
        eyebrow="Activity"
        right={
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            recent
          </span>
        }
      />
      <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
        <EpisodicQueries queries={queries} />
        <EpisodicWrites writes={writes} />
      </div>
    </>
  )
}

function EpisodicEntries({ entries, color }: { entries: readonly MemoryEpisodicEntry[]; color: string }) {
  const [tab, setTab] = useState('recent')
  const [activeTag, setActiveTag] = useState<string | null>(null)

  const hasConf = entries.some((e) => e.confidence != null)
  const allTags = useMemo(
    () => Array.from(new Set(entries.flatMap((e) => e.tags ?? []))).sort((a, b) => a.localeCompare(b)),
    [entries],
  )
  const hasTags = allTags.length > 0

  const recent = useMemo(() => [...entries].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)), [entries])
  const byConf = useMemo(
    () => entries.filter((e) => e.confidence != null).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)),
    [entries],
  )
  const byTag = useMemo(
    () => (activeTag ? recent.filter((e) => (e.tags ?? []).includes(activeTag)) : recent),
    [recent, activeTag],
  )

  // Live entries can change under us (WS pushes), dropping the confidence/tag
  // capability that backs the current tab. Clamp to 'recent' so the UI never
  // sticks on a tab whose content has disappeared.
  useEffect(() => {
    if ((tab === 'conf' && !hasConf) || (tab === 'tag' && !hasTags)) setTab('recent')
  }, [tab, hasConf, hasTags])

  // Same for the active tag filter: if the tag is no longer present, reset it
  // so 'By tag' doesn't render a permanent "No entries for this tag." state.
  useEffect(() => {
    if (activeTag != null && !allTags.includes(activeTag)) setActiveTag(null)
  }, [activeTag, allTags])

  if (entries.length === 0) {
    return (
      <LDCard title="Stored entries" color={color}>
        <EmptyInline>No entries captured yet.</EmptyInline>
      </LDCard>
    )
  }

  // "Highest conf." only when episodes carry confidence (embedded stores);
  // "By tag" only when entries are tagged. Both are real capabilities — they
  // just don't apply to a plain recency store with untagged episodes.
  const tabs: MemoryTabSpec[] = [
    { value: 'recent', label: 'Recent', count: recent.length },
    ...(hasConf ? [{ value: 'conf', label: 'Highest conf.', count: byConf.length }] : []),
    ...(hasTags ? [{ value: 'tag', label: 'By tag', count: allTags.length }] : []),
  ]

  // Only one view applies → drop the tab chrome; a lone "Recent" pill is noise.
  if (tabs.length === 1) {
    return (
      <LDCard title="Stored entries" color={color}>
        <EpisodicEntryList entries={recent} />
      </LDCard>
    )
  }

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <LDCard title="Stored entries" color={color} right={<MemoryCardTabs tabs={tabs} />}>
        <TabsContent value="recent" className="m-0">
          <EpisodicEntryList entries={recent} />
        </TabsContent>
        {hasConf && (
          <TabsContent value="conf" className="m-0">
            <EpisodicEntryList entries={byConf} />
          </TabsContent>
        )}
        {hasTags && (
          <TabsContent value="tag" className="m-0">
            <TagFilterRow tags={allTags} active={activeTag} onPick={setActiveTag} />
            {byTag.length === 0 ? (
              <EmptyInline>No entries for this tag.</EmptyInline>
            ) : (
              <EpisodicEntryList entries={byTag} />
            )}
          </TabsContent>
        )}
      </LDCard>
    </Tabs>
  )
}

function EpisodicEntryList({ entries }: { entries: readonly MemoryEpisodicEntry[] }) {
  return (
    <>
      {entries.map((e, i) => (
        <EpisodicEntryRow key={e.id} entry={e} last={i === entries.length - 1} />
      ))}
    </>
  )
}

function TagFilterRow({
  tags,
  active,
  onPick,
}: {
  tags: readonly string[]
  active: string | null
  onPick: (tag: string | null) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-2.5" style={{ borderBottom: '1px solid var(--qw-border)' }}>
      <TagFilterChip label="All" selected={active == null} onClick={() => onPick(null)} />
      {tags.map((t) => (
        <TagFilterChip key={t} label={t} selected={active === t} onClick={() => onPick(t)} />
      ))}
    </div>
  )
}

function TagFilterChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[4px] px-2 py-[2px] font-mono text-[10.5px] transition-colors"
      style={
        selected
          ? { background: 'var(--qw-iris-soft)', color: 'var(--qw-iris)', border: '1px solid var(--qw-iris)' }
          : { background: 'var(--qw-bg-muted)', color: 'var(--qw-fg-muted)', border: '1px solid var(--qw-border)' }
      }
    >
      {label}
    </button>
  )
}

function EpisodicEntryRow({ entry, last }: { entry: MemoryEpisodicEntry; last: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const conf = entry.confidence
  // Episode content is markdown (often full chat turns). Render it, but cap the
  // collapsed height so the list stays scannable; full text on expand.
  const longContent = entry.content.length > 240
  const capped = longContent && !expanded
  return (
    <div className="px-4 py-3" style={{ borderBottom: last ? 'none' : '1px solid var(--qw-border)' }}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="max-w-full truncate font-mono text-[11px]" style={{ color: 'var(--qw-crux)' }} title={entry.id}>
          {shortEntryId(entry.id)}
        </span>
        {entry.timestamp && (
          <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {fmtTime(entry.timestamp)}
          </span>
        )}
        {conf != null && (
          <span className="font-mono text-[10.5px]" style={{ color: scoreTone(conf) }}>
            conf {conf.toFixed(2)}
          </span>
        )}
        {entry.tags && entry.tags.length > 0 && (
          <span className="ml-auto flex flex-wrap gap-1">
            {entry.tags.map((t) => (
              <Chip key={t} tone="muted">
                {t}
              </Chip>
            ))}
          </span>
        )}
      </div>
      <div className="relative mb-1">
        <div className={`qw-prose break-words text-[13px] leading-[1.55] ${capped ? 'max-h-28 overflow-hidden' : ''}`}>
          <Streamdown>{entry.content}</Streamdown>
        </div>
        {capped && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
            style={{ background: 'linear-gradient(to bottom, transparent, var(--qw-bg-elev))' }}
          />
        )}
      </div>
      {longContent && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mb-1.5 font-mono text-[10.5px] underline-offset-2 hover:underline"
          style={{ color: 'var(--qw-crux)' }}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
      {(entry.writtenBy || entry.sourceRun || entry.sourceTraceId) && (
        <div className="flex flex-wrap gap-3 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {entry.writtenBy && (
            <span>
              written by · <span style={{ color: 'var(--qw-fg)' }}>{entry.writtenBy}</span>
            </span>
          )}
          {entry.sourceRun && (
            <span>
              from run · <RunLink id={entry.sourceRun} />
            </span>
          )}
          {entry.sourceTraceId && (
            <span>
              trace · <RunLink id={entry.sourceTraceId} />
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function EpisodicQueries({ queries }: { queries: readonly MemoryEpisodicQuery[] }) {
  // topScore is absent without vector recall — hide the column rather than show "—".
  const hasTop = queries.some((q) => q.topScore != null)
  const hasLat = queries.some((q) => q.latencyMs != null)
  const hasTrace = queries.some((q) => q.traceId)
  const cols: ColDef[] = [
    { label: 'time', width: '70px' },
    { label: 'query', width: 'minmax(0, 1fr)' },
    { label: 'k', width: '36px', align: 'right' },
    ...(hasTop ? [{ label: 'top', width: '50px', align: 'right' as const }] : []),
    ...(hasLat ? [{ label: 'lat', width: '50px', align: 'right' as const }] : []),
    ...(hasTrace ? [{ label: 'trace', width: '60px', align: 'right' as const }] : []),
  ]
  const gridCols = cols.map((c) => c.width).join(' ')
  return (
    <LDCard title="Queries" color="var(--qw-crux)">
      {queries.length === 0 ? (
        <EmptyInline>No queries captured yet.</EmptyInline>
      ) : (
        <>
          <TableHeader cols={cols} />
          {queries.map((q, i) => (
            <div
              key={q.eventId}
              className="grid items-center gap-2 px-3.5 py-2 font-mono text-[11px]"
              style={{
                gridTemplateColumns: gridCols,
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
              {hasTop && (
                <span className="text-right font-semibold" style={{ color: scoreTone(q.topScore) }}>
                  {q.topScore?.toFixed(2) ?? '—'}
                </span>
              )}
              {hasLat && (
                <span className="text-right" style={{ color: 'var(--qw-fg-faint)' }}>
                  {q.latencyMs != null ? `${q.latencyMs}ms` : '—'}
                </span>
              )}
              {hasTrace && (
                <span className="text-right">
                  {q.traceId ? <RunLink id={q.traceId} /> : <span style={{ color: 'var(--qw-fg-faint)' }}>—</span>}
                </span>
              )}
            </div>
          ))}
        </>
      )}
    </LDCard>
  )
}

function EpisodicWrites({ writes }: { writes: readonly MemoryEpisodicWrite[] }) {
  const hasBy = writes.some((w) => w.writtenBy)
  const hasConf = writes.some((w) => w.confidence != null)
  const hasTrace = writes.some((w) => w.traceId)
  const cols: ColDef[] = [
    { label: 'time', width: '70px' },
    { label: 'op', width: '64px' },
    { label: 'id', width: '80px' },
    { label: 'content', width: 'minmax(0, 1fr)' },
    ...(hasBy ? [{ label: 'by', width: '110px' }] : []),
    ...(hasConf ? [{ label: 'conf', width: '50px', align: 'right' as const }] : []),
    ...(hasTrace ? [{ label: 'trace', width: '60px', align: 'right' as const }] : []),
  ]
  const gridCols = cols.map((c) => c.width).join(' ')
  return (
    <LDCard title="Writes & evictions" color="var(--qw-iris)">
      {writes.length === 0 ? (
        <EmptyInline>No writes captured yet.</EmptyInline>
      ) : (
        <>
          <TableHeader cols={cols} />
          {writes.map((w, i) => (
            <div
              key={w.eventId}
              className="grid items-center gap-2 px-3.5 py-2 font-mono text-[11px]"
              style={{
                gridTemplateColumns: gridCols,
                borderBottom: i === writes.length - 1 ? 'none' : '1px solid var(--qw-border)',
              }}
            >
              <span style={{ color: 'var(--qw-fg-faint)' }}>{fmtTime(w.timestamp)}</span>
              <LDOpPill op={w.op} />
              <span className="truncate" style={{ color: 'var(--qw-crux)' }} title={w.entryId}>
                {w.entryId ? shortEntryId(w.entryId) : '—'}
              </span>
              <span className="truncate" style={{ color: 'var(--qw-fg)' }} title={w.contentPreview}>
                {w.contentPreview ?? '—'}
              </span>
              {hasBy && (
                <span className="truncate" style={{ color: 'var(--qw-fg-muted)' }} title={w.writtenBy}>
                  {w.writtenBy ?? '—'}
                </span>
              )}
              {hasConf && (
                <span className="text-right" style={{ color: scoreTone(w.confidence) }}>
                  {w.confidence?.toFixed(2) ?? '—'}
                </span>
              )}
              {hasTrace && (
                <span className="text-right">
                  {w.traceId ? <RunLink id={w.traceId} /> : <span style={{ color: 'var(--qw-fg-faint)' }}>—</span>}
                </span>
              )}
            </div>
          ))}
        </>
      )}
    </LDCard>
  )
}

interface MetaRow {
  k: string
  v: ReactNode
  sub?: ReactNode
}

function MetaRows({ rows }: { rows: readonly MetaRow[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map(({ k, v, sub }) => (
        <div
          key={k}
          className="grid items-baseline gap-2.5 font-mono text-[11.5px]"
          style={{ gridTemplateColumns: '110px minmax(0, 1fr) auto' }}
        >
          <span style={{ color: 'var(--qw-fg-faint)' }}>{k}</span>
          {v}
          <span className="text-right text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {sub ?? null}
          </span>
        </div>
      ))}
    </div>
  )
}

function indexStatusColor(status: string): string {
  if (status === 'fresh') return 'var(--qw-ok)'
  if (status === 'stale' || status === 'rebuilding') return 'var(--qw-warn)'
  return 'var(--qw-fg-muted)'
}

function EpisodicIndexCard({ index }: { index: MemoryEpisodicState['index'] }) {
  // Recency-backed stores carry no vector index. Render the absence honestly
  // instead of a "pending telemetry" placeholder that implies missing wiring.
  if (!index) {
    return (
      <LDCard title="Index health" padding="12px 14px">
        <div
          className="text-[12px] leading-[1.5]"
          style={{ color: 'var(--qw-fg-muted)', fontFamily: 'var(--qw-serif, Georgia, serif)' }}
        >
          <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em]" style={{ color: 'var(--qw-fg-faint)' }}>
            Recency-backed
          </div>
          No vector index — episodes are recalled by recency, not similarity.
        </div>
      </LDCard>
    )
  }
  const rows: MetaRow[] = []
  if (index.status) {
    rows.push({
      k: 'Vector index',
      v: <span style={{ color: indexStatusColor(index.status) }}>{index.status}</span>,
      sub:
        index.indexedCount != null && index.targetCount != null ? (
          <span>
            {index.indexedCount} / {index.targetCount} indexed
          </span>
        ) : undefined,
    })
  }
  if (index.embeddingModel) {
    rows.push({
      k: 'Embedding',
      v: <span style={{ color: 'var(--qw-fg)' }}>{index.embeddingModel}</span>,
      sub: index.dimensions != null ? <span>{index.dimensions}d</span> : undefined,
    })
  }
  if (index.distance) {
    rows.push({ k: 'Distance', v: <span style={{ color: 'var(--qw-fg)' }}>{index.distance}</span> })
  }
  return (
    <LDCard title="Index health" padding="12px 14px">
      {rows.length === 0 ? (
        <div className="font-mono text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          Indexed.
        </div>
      ) : (
        <MetaRows rows={rows} />
      )}
    </LDCard>
  )
}

function EpisodicRetentionCard({ retention }: { retention: MemoryEpisodicState['retention'] }) {
  if (!retention) return null
  const rows: MetaRow[] = []
  if (retention.policy) {
    rows.push({
      k: 'Retention',
      v: <span style={{ color: 'var(--qw-fg)' }}>{retention.policy}</span>,
      sub: <span>policy window</span>,
    })
  }
  // GC stats only appear after the first retention sweep has run.
  if (retention.lastGcAt) {
    rows.push({
      k: 'Last GC',
      v: <span style={{ color: 'var(--qw-fg-muted)' }}>{fmtRelative(retention.lastGcAt)}</span>,
      sub: retention.lastGcEvicted != null ? <span>evicted {retention.lastGcEvicted} stale</span> : undefined,
    })
  }
  if (rows.length === 0) return null
  return (
    <LDCard title="Retention" padding="12px 14px">
      <MetaRows rows={rows} />
    </LDCard>
  )
}
