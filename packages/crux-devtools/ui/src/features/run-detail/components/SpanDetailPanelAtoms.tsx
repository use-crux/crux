import type { ReactNode } from 'react'
import { Icon } from '@/qw/shell/Icon'

export function CardShell({ label, right, children }: { label: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em]"
        style={{
          color: 'var(--qw-fg-faint)',
          background: 'var(--qw-bg-muted)',
          borderBottom: '1px solid var(--qw-border)',
        }}
      >
        <span>{label}</span>
        {right && <span style={{ textTransform: 'none', letterSpacing: 0 }}>{right}</span>}
      </div>
      {children}
    </div>
  )
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-[10px] px-6 py-10 text-center text-[12.5px]"
      style={{
        background: 'var(--qw-bg-elev)',
        border: '1px dashed var(--qw-border)',
        color: 'var(--qw-fg-muted)',
      }}
    >
      {children}
    </div>
  )
}

export function PendingFromBackend({ what }: { what: string }) {
  return (
    <div
      className="flex items-start gap-3 rounded-[10px] px-4 py-3 text-[12px]"
      style={{
        background: 'var(--qw-warn-soft)',
        border: '1px dashed var(--qw-warn)',
        color: 'var(--qw-warn)',
      }}
    >
      <Icon name="x" size={13} color="var(--qw-warn)" />
      <div className="flex-1">
        <div className="font-semibold">{what} — pending backend projection</div>
        <div className="mt-1 opacity-80" style={{ color: 'var(--qw-fg-muted)' }}>
          This card lights up once the backend includes the data on /api/quality/runs/{'{traceId}'}.
        </div>
      </div>
    </div>
  )
}

export function KeyValue({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 font-mono text-[11.5px]">
      <span style={{ color: 'var(--qw-fg-faint)', minWidth: 110 }}>{k}</span>
      <span className="flex-1 break-all" style={{ color: 'var(--qw-fg)' }}>
        {v}
      </span>
    </div>
  )
}
