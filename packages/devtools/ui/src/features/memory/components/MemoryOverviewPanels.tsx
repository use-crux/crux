import { Chip, SectionHead } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import type { IconName } from '@/qw/shell/nav'
import {
  fmtCount,
  fmtTime,
  fmtValue,
  healthTone,
  scoreTone,
  shortTrace,
  typeMeta,
} from '@/features/memory/lib/memory-format'
import { EmptyInline, LDKV, LDOpPill, Stat, TableHeader } from './MemoryAtoms'
import type {
  MemoryEpisodicState,
  MemoryOperationRecord,
  MemoryStore,
  MemoryStoreDetail,
  MemoryWorkingState,
} from '@/types'

export function SpotlightWorking({
  store,
  onOpen,
}: {
  store: MemoryStoreDetail | undefined
  onOpen: (id: string) => void
}) {
  if (!store || store.state.type !== 'working') {
    return (
      <SpotlightPlaceholder
        icon="brain"
        color="var(--qw-crux)"
        title="Current state"
        message="No working memory store observed yet."
      />
    )
  }
  const fields = (store.state as MemoryWorkingState).fields ?? []
  const previewFields = fields.slice(0, 6)
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-crux-line)' }}
    >
      <button
        type="button"
        onClick={() => onOpen(store.id)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-opacity hover:opacity-95"
        style={{ borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-crux-soft)' }}
      >
        <Icon name="brain" size={14} color="var(--qw-crux)" className="shrink-0" />
        <span className="shrink-0 text-[13px] font-semibold">Current state ·</span>
        <span className="min-w-0 truncate font-mono text-[12px]" style={{ color: 'var(--qw-crux)' }} title={store.id}>
          {store.id}
        </span>
        <Chip tone="crux" mono className="shrink-0">
          working
        </Chip>
        <span className="ml-auto shrink-0 font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {fields.length} field{fields.length === 1 ? '' : 's'}
        </span>
      </button>
      {previewFields.length === 0 ? (
        <EmptyInline>No fields captured yet.</EmptyInline>
      ) : (
        previewFields.map((f, i) => (
          <LDKV key={f.name} k={f.name} type={f.ty} v={fmtValue(f.value)} last={i === previewFields.length - 1} />
        ))
      )}
    </div>
  )
}

export function SpotlightEpisodic({
  store,
  onOpen,
}: {
  store: MemoryStoreDetail | undefined
  onOpen: (id: string) => void
}) {
  if (!store || store.state.type !== 'episodic') {
    return (
      <SpotlightPlaceholder
        icon="book"
        color="var(--qw-iris)"
        title="Stored entries"
        message="No episodic memory store observed yet."
      />
    )
  }
  const entries = (store.state as MemoryEpisodicState).entries ?? []
  const preview = entries.slice(0, 3)
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <button
        type="button"
        onClick={() => onOpen(store.id)}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-opacity hover:opacity-95"
        style={{ borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-bg-muted)' }}
      >
        <Icon name="book" size={14} color="var(--qw-iris)" className="shrink-0" />
        <span className="shrink-0 text-[13px] font-semibold">Stored entries ·</span>
        <span className="min-w-0 truncate font-mono text-[12px]" style={{ color: 'var(--qw-crux)' }} title={store.id}>
          {store.id}
        </span>
        <Chip tone="iris" mono className="shrink-0">
          episodic
        </Chip>
        <span className="ml-auto shrink-0 font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {preview.length} of {entries.length}
        </span>
      </button>
      {preview.length === 0 ? (
        <EmptyInline>No entries captured yet.</EmptyInline>
      ) : (
        preview.map((e, i) => (
          <div
            key={e.id}
            className="px-4 py-3"
            style={{ borderBottom: i === preview.length - 1 ? 'none' : '1px solid var(--qw-border)' }}
          >
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {fmtTime(e.timestamp) ?? '—'}
              </span>
              {e.confidence != null && (
                <>
                  <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                    ·
                  </span>
                  <span className="font-mono text-[10.5px]" style={{ color: scoreTone(e.confidence) }}>
                    conf {e.confidence.toFixed(2)}
                  </span>
                </>
              )}
            </div>
            <div className="text-[13px] leading-[1.5]" style={{ fontFamily: 'var(--qw-serif, Georgia, serif)' }}>
              {e.content}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function SpotlightPlaceholder({
  icon,
  color,
  title,
  message,
}: {
  icon: IconName
  color: string
  title: string
  message: string
}) {
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px dashed var(--qw-border)' }}
    >
      <div
        className="flex items-center gap-2 px-4 py-2.5"
        style={{ borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-bg-muted)' }}
      >
        <Icon name={icon} size={14} color={color} />
        <span className="text-[13px] font-semibold">{title}</span>
      </div>
      <div className="px-4 py-6 text-center text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
        {message}
      </div>
    </div>
  )
}

export function OperationHistoryTable({
  operations,
  onOpen,
}: {
  operations: readonly MemoryOperationRecord[]
  onOpen: (storeId: string) => void
}) {
  const hasTrace = operations.some((o) => o.traceId)
  return (
    <section>
      <SectionHead
        eyebrow="Operation history"
        right={
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            all stores · last {operations.length}
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
            { label: 'op', width: '70px' },
            { label: 'store', width: '180px' },
            { label: 'key', width: 'minmax(0, 1fr)' },
            { label: 'value', width: 'minmax(0, 200px)' },
            ...(hasTrace ? [{ label: 'trace', width: '70px', align: 'right' as const }] : []),
          ]}
        />
        {operations.map((o, i) => {
          const tm = typeMeta(o.storeType)
          return (
            <button
              key={o.eventId}
              type="button"
              onClick={() => onOpen(o.storeId)}
              className="grid w-full items-center gap-2.5 px-4 py-2 text-left font-mono text-[11.5px] transition-colors hover:bg-(--qw-bg-muted)"
              style={{
                gridTemplateColumns: [
                  '70px',
                  '70px',
                  '180px',
                  'minmax(0, 1fr)',
                  'minmax(0, 200px)',
                  hasTrace ? '70px' : '',
                ]
                  .filter(Boolean)
                  .join(' '),
                borderBottom: i === operations.length - 1 ? 'none' : '1px solid var(--qw-border)',
              }}
            >
              <span style={{ color: 'var(--qw-fg-faint)' }}>{fmtTime(o.timestamp)}</span>
              <LDOpPill op={o.op} />
              <span className="truncate" style={{ color: tm.color }} title={o.storeId}>
                {o.storeId}
              </span>
              <span className="truncate" style={{ color: 'var(--qw-fg)' }} title={o.key}>
                {o.key}
              </span>
              <span className="truncate" style={{ color: 'var(--qw-fg-muted)' }} title={o.value}>
                {o.value}
              </span>
              {hasTrace && (
                <span className="text-right" style={{ color: 'var(--qw-crux)' }}>
                  {shortTrace(o.traceId) ?? '—'}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function StoreCard({
  store,
  onOpen,
  onHover,
}: {
  store: MemoryStore
  onOpen: () => void
  /** Fired on mouseEnter/focus — bind to a prefetch hook so navigation
   *  feels instant once the user clicks. */
  onHover?: () => void
}) {
  const m = typeMeta(store.type)
  const lastAt = fmtTime(store.stats?.lifetime?.lastTouchedAt)
  return (
    <button
      type="button"
      onClick={onOpen}
      onMouseEnter={onHover}
      onFocus={onHover}
      className="flex flex-col gap-2.5 rounded-[10px] border px-4 py-3.5 text-left transition-colors hover:border-(--qw-crux-line)"
      style={{ background: 'var(--qw-bg-elev)', borderColor: 'var(--qw-border)' }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon name={m.icon} size={14} color={m.color} className="shrink-0" />
        <span className="min-w-0 truncate font-mono text-[13.5px] font-semibold" title={store.id}>
          {store.id}
        </span>
        <Chip tone={m.tone} mono className="shrink-0">
          {m.label}
        </Chip>
        <Chip tone={healthTone(store.health)} dot className="shrink-0">
          {store.health}
        </Chip>
        {lastAt && (
          <span className="ml-auto shrink-0 font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            last · {lastAt}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-5">
        <Stat label="Reads" value={store.stats?.reads} />
        <Stat label="Writes" value={store.stats?.writes} />
        <Stat label="Entries" value={fmtCount(store.stats?.entries ?? null)} />
        {store.stats?.conflicts != null && store.stats.conflicts > 0 && (
          <Stat label="Conflicts" value={store.stats.conflicts} color="var(--qw-warn)" />
        )}
        <div className="flex-1" />
        {store.lastTraceId && (
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
            run · <span style={{ color: 'var(--qw-crux)' }}>{shortTrace(store.lastTraceId)}</span>
          </span>
        )}
      </div>
      {store.label && store.label !== store.id && (
        <div className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {store.label}
        </div>
      )}
    </button>
  )
}
