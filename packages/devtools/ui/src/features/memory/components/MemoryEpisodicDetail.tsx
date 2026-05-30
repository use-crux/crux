import { useMemo } from 'react'
import { Chip, SectionHead } from '@/qw/shell/primitives'
import { fmtRelative, fmtTime, healthTone, scoreTone, shortTrace, typeMeta } from '@/features/memory/lib/memory-format'
import { DefinitionBindingCard } from './MemoryBinding'
import { EmptyInline, LDCard, LDHeaderStrip, LDOpPill, TableHeader } from './MemoryAtoms'
import { SchemaCard } from './MemorySchema'
import type {
  MemoryEpisodicEntry,
  MemoryEpisodicQuery,
  MemoryEpisodicState,
  MemoryEpisodicWrite,
  MemoryStoreDetail,
} from '@/types'

export function EpisodicDetail({ store, state }: { store: MemoryStoreDetail; state: MemoryEpisodicState }) {
  const m = typeMeta('episodic')
  const entries = state.entries ?? []
  const queries = state.queries ?? []
  const writes = state.writes ?? []
  const avgConf = useMemo(() => {
    const withConf = entries.filter((e) => typeof e.confidence === 'number')
    if (withConf.length === 0) return null
    return withConf.reduce((a, e) => a + (e.confidence ?? 0), 0) / withConf.length
  }, [entries])

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
          { label: 'Reads', value: store.stats?.reads ?? '—' },
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

      <div className="mb-5 grid gap-4" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <LDCard title="Stored entries" color={m.color}>
          {entries.length === 0 ? (
            <EmptyInline>No entries captured yet.</EmptyInline>
          ) : (
            entries.map((e, i) => <EpisodicEntryRow key={e.id} entry={e} last={i === entries.length - 1} />)
          )}
        </LDCard>

        <div className="flex flex-col gap-3.5">
          <SchemaCard schema={store.schema} color={m.color} authoringHint="episodicMemory({ entry })" />
          <EpisodicIndexHealthCard state={state} />
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

function EpisodicEntryRow({ entry, last }: { entry: MemoryEpisodicEntry; last: boolean }) {
  const conf = entry.confidence
  return (
    <div className="px-4 py-3" style={{ borderBottom: last ? 'none' : '1px solid var(--qw-border)' }}>
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px]" style={{ color: 'var(--qw-crux)' }}>
          {entry.id}
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
      <div className="mb-1.5 text-[13px] leading-[1.55]" style={{ fontFamily: 'var(--qw-serif, Georgia, serif)' }}>
        {entry.content}
      </div>
      {(entry.writtenBy || entry.sourceTraceId) && (
        <div className="flex flex-wrap gap-3 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {entry.writtenBy && (
            <span>
              written by · <span style={{ color: 'var(--qw-fg)' }}>{entry.writtenBy}</span>
            </span>
          )}
          {entry.sourceTraceId && (
            <span>
              from trace · <span style={{ color: 'var(--qw-crux)' }}>{shortTrace(entry.sourceTraceId)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function EpisodicQueries({ queries }: { queries: readonly MemoryEpisodicQuery[] }) {
  const hasLat = queries.some((q) => q.latencyMs != null)
  const hasTrace = queries.some((q) => q.traceId)
  return (
    <LDCard title="Queries" color="var(--qw-crux)">
      {queries.length === 0 ? (
        <EmptyInline>No queries captured yet.</EmptyInline>
      ) : (
        <>
          <TableHeader
            cols={[
              { label: 'time', width: '70px' },
              { label: 'query', width: 'minmax(0, 1fr)' },
              { label: 'k', width: '36px', align: 'right' },
              { label: 'top', width: '50px', align: 'right' },
              ...(hasLat ? [{ label: 'lat', width: '50px', align: 'right' as const }] : []),
              ...(hasTrace ? [{ label: 'trace', width: '60px', align: 'right' as const }] : []),
            ]}
          />
          {queries.map((q, i) => (
            <div
              key={q.eventId}
              className="grid items-center gap-2 px-3.5 py-2 font-mono text-[11px]"
              style={{
                gridTemplateColumns: [
                  '70px',
                  'minmax(0, 1fr)',
                  '36px',
                  '50px',
                  hasLat ? '50px' : '',
                  hasTrace ? '60px' : '',
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
        </>
      )}
    </LDCard>
  )
}

function EpisodicWrites({ writes }: { writes: readonly MemoryEpisodicWrite[] }) {
  const hasConf = writes.some((w) => w.confidence != null)
  const hasTrace = writes.some((w) => w.traceId)
  return (
    <LDCard title="Writes & evictions" color="var(--qw-iris)">
      {writes.length === 0 ? (
        <EmptyInline>No writes captured yet.</EmptyInline>
      ) : (
        <>
          <TableHeader
            cols={[
              { label: 'time', width: '70px' },
              { label: 'op', width: '60px' },
              { label: 'id', width: '80px' },
              { label: 'content', width: 'minmax(0, 1fr)' },
              ...(hasConf ? [{ label: 'conf', width: '50px', align: 'right' as const }] : []),
              ...(hasTrace ? [{ label: 'trace', width: '60px', align: 'right' as const }] : []),
            ]}
          />
          {writes.map((w, i) => (
            <div
              key={w.eventId}
              className="grid items-center gap-2 px-3.5 py-2 font-mono text-[11px]"
              style={{
                gridTemplateColumns: [
                  '70px',
                  '60px',
                  '80px',
                  'minmax(0, 1fr)',
                  hasConf ? '50px' : '',
                  hasTrace ? '60px' : '',
                ]
                  .filter(Boolean)
                  .join(' '),
                borderBottom: i === writes.length - 1 ? 'none' : '1px solid var(--qw-border)',
              }}
            >
              <span style={{ color: 'var(--qw-fg-faint)' }}>{fmtTime(w.timestamp)}</span>
              <LDOpPill op={w.op} />
              <span style={{ color: 'var(--qw-crux)' }}>{w.entryId ?? '—'}</span>
              <span className="truncate" style={{ color: 'var(--qw-fg)' }} title={w.contentPreview}>
                {w.contentPreview ?? '—'}
              </span>
              {hasConf && (
                <span className="text-right" style={{ color: scoreTone(w.confidence) }}>
                  {w.confidence?.toFixed(2) ?? '—'}
                </span>
              )}
              {hasTrace && (
                <span className="text-right" style={{ color: 'var(--qw-crux)' }}>
                  {shortTrace(w.traceId) ?? '—'}
                </span>
              )}
            </div>
          ))}
        </>
      )}
    </LDCard>
  )
}

function EpisodicIndexHealthCard({ state }: { state: MemoryEpisodicState }) {
  const idx = state.index
  const ret = state.retention
  const rows: Array<[string, React.ReactNode, React.ReactNode?]> = []
  if (idx?.status) {
    const statusColor =
      idx.status === 'fresh'
        ? 'var(--qw-ok)'
        : idx.status === 'stale' || idx.status === 'rebuilding'
          ? 'var(--qw-warn)'
          : 'var(--qw-fg-muted)'
    rows.push([
      'Vector index',
      <span style={{ color: statusColor }}>{idx.status}</span>,
      idx.indexedCount != null && idx.targetCount != null ? (
        <span style={{ color: 'var(--qw-fg-faint)' }}>
          {idx.indexedCount} / {idx.targetCount} indexed
        </span>
      ) : undefined,
    ])
  }
  if (idx?.embeddingModel) {
    rows.push([
      'Embedding',
      <span style={{ color: 'var(--qw-fg)' }}>{idx.embeddingModel}</span>,
      idx.dimensions != null ? <span style={{ color: 'var(--qw-fg-faint)' }}>{idx.dimensions}d</span> : undefined,
    ])
  }
  if (idx?.distance) {
    rows.push(['Distance', <span style={{ color: 'var(--qw-fg)' }}>{idx.distance}</span>])
  }
  if (ret?.lastGcAt) {
    rows.push([
      'Last GC',
      <span style={{ color: 'var(--qw-fg-muted)' }}>{fmtRelative(ret.lastGcAt)}</span>,
      ret.lastGcEvicted != null ? (
        <span style={{ color: 'var(--qw-fg-faint)' }}>evicted {ret.lastGcEvicted} stale</span>
      ) : undefined,
    ])
  }
  if (ret?.policy && !ret.lastGcAt) {
    rows.push(['Retention', <span style={{ color: 'var(--qw-fg)' }}>{ret.policy}</span>])
  }
  return (
    <LDCard title="Index health" padding="12px 14px">
      {rows.length === 0 ? (
        <div
          className="text-[12px] leading-[1.5]"
          style={{
            color: 'var(--qw-fg-muted)',
            fontFamily: 'var(--qw-serif, Georgia, serif)',
          }}
        >
          <div
            className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em]"
            style={{ color: 'var(--qw-fg-faint)' }}
          >
            Pending index telemetry
          </div>
          Embedding model, dimensions, distance, indexed count and last-GC stats appear here once the episodic backend
          ships them.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(([k, v, sub]) => (
            <div
              key={String(k)}
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
      )}
    </LDCard>
  )
}
