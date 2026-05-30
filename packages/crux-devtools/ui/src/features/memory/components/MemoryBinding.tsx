import { fmtRelative, shortTrace } from '@/features/memory/lib/memory-format'
import { LDCard } from './MemoryAtoms'
import type { MemoryStoreDetail } from '@/types'

export function DefinitionBindingCard({ store, note }: { store: MemoryStoreDetail; note?: string }) {
  const rows: Array<[string, React.ReactNode]> = []
  if (store.owner) {
    rows.push(['owner', <span style={{ color: 'var(--qw-fg)' }}>{store.owner}</span>])
  }
  if (store.label && store.label !== store.id) {
    rows.push(['label', <span style={{ color: 'var(--qw-fg)' }}>{store.label}</span>])
  }
  if (store.source) {
    rows.push([
      'source',
      <button
        type="button"
        className="font-mono text-left transition-opacity hover:opacity-80"
        style={{ color: 'var(--qw-crux)' }}
        onClick={() => {
          window.location.href = `vscode://file${store.source!.file}:${store.source!.line}`
        }}
        title={`Open ${store.source.file}:${store.source.line} in your editor`}
      >
        {store.source.file.split('/').slice(-3).join('/')}:{store.source.line}
      </button>,
    ])
  }
  if (store.backend) {
    rows.push(['backend', <span style={{ color: 'var(--qw-fg)' }}>{store.backend}</span>])
  }
  if (store.scope) {
    rows.push([
      'scope',
      <span>
        {store.scope.kind} ·{' '}
        <span className="font-mono" style={{ color: 'var(--qw-crux)' }} title={store.scope.id}>
          {store.scope.id.length > 24 ? `${store.scope.id.slice(0, 24)}…` : store.scope.id}
        </span>
      </span>,
    ])
  }
  if (store.conflictPolicy) {
    rows.push(['conflict', <span style={{ color: 'var(--qw-fg)' }}>{store.conflictPolicy}</span>])
  }
  if (store.evictionPolicy) {
    rows.push(['eviction', <span style={{ color: 'var(--qw-fg)' }}>{store.evictionPolicy}</span>])
  }
  if (store.health) {
    rows.push(['health', <span style={{ color: 'var(--qw-fg)' }}>{store.health}</span>])
  }
  if (store.lastRunId) {
    rows.push([
      'last run',
      <span className="font-mono" style={{ color: 'var(--qw-crux)' }}>
        {shortTrace(store.lastRunId)}
      </span>,
    ])
  }
  if (store.lastTraceId && store.lastTraceId !== store.lastRunId) {
    rows.push([
      'last trace',
      <span className="font-mono" style={{ color: 'var(--qw-crux)' }}>
        {shortTrace(store.lastTraceId)}
      </span>,
    ])
  }
  if (store.stats?.lifetime?.startedAt) {
    rows.push([
      'started',
      <span style={{ color: 'var(--qw-fg-muted)' }}>{fmtRelative(store.stats.lifetime.startedAt) ?? '—'}</span>,
    ])
  }
  return (
    <LDCard title="Binding" padding="12px 14px">
      <div className="flex flex-col gap-1.5 font-mono text-[11.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2.5">
            <span style={{ color: 'var(--qw-fg-faint)', minWidth: 80 }}>{k}</span>
            {v}
          </div>
        ))}
      </div>
      {note && (
        <div
          className="mt-2.5 pt-2.5 text-[12px] leading-[1.5]"
          style={{
            borderTop: '1px dashed var(--qw-border)',
            color: 'var(--qw-fg-muted)',
            fontFamily: 'var(--qw-serif, Georgia, serif)',
          }}
        >
          {note}
        </div>
      )}
    </LDCard>
  )
}
