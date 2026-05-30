import type { ReactNode } from 'react'
import { opPillTone } from '@/features/workspaces/lib/workspace-format'

export function OpPill({ op }: { op: string }) {
  const t = opPillTone(op)
  return (
    <span
      className="inline-flex w-fit shrink-0 rounded-[3px] px-1.5 py-[1px] font-mono text-[10.5px] font-semibold"
      style={{ background: t.bg, color: t.fg }}
    >
      {op}
    </span>
  )
}

export function Stat({
  label,
  value,
  color,
}: {
  label: string
  value: number | string | null | undefined
  color?: string
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--qw-fg-faint)' }}>
        {label}
      </span>
      <span
        className="font-mono text-[14px] font-semibold"
        style={{ color: color ?? (value == null ? 'var(--qw-fg-faint)' : 'var(--qw-fg)') }}
      >
        {value == null ? '—' : value}
      </span>
    </div>
  )
}

export function TableHeader({ cols }: { cols: readonly { label: string; width: string; align?: 'left' | 'right' }[] }) {
  return (
    <div
      className="grid gap-2.5 px-4 py-2 text-[10px] uppercase tracking-[0.1em]"
      style={{
        gridTemplateColumns: cols.map((c) => c.width).join(' '),
        color: 'var(--qw-fg-faint)',
        borderBottom: '1px solid var(--qw-border)',
        background: 'var(--qw-bg-muted)',
      }}
    >
      {cols.map((c) => (
        <div key={c.label} style={{ textAlign: c.align ?? 'left' }}>
          {c.label}
        </div>
      ))}
    </div>
  )
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-[10px] px-6 py-10 text-center text-[13px]"
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

export function EmptyInline({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 py-5 text-center text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
      {children}
    </div>
  )
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="mb-4 rounded-[8px] px-4 py-3 text-[12px]"
      style={{ background: 'var(--qw-danger-soft)', color: 'var(--qw-danger)' }}
    >
      {message}
    </div>
  )
}

export function PendingBackend({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-[10px] px-5 py-4 text-[12.5px]"
      style={{
        background: 'var(--qw-bg-elev)',
        border: '1px dashed var(--qw-border)',
        color: 'var(--qw-fg-muted)',
      }}
    >
      <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em]" style={{ color: 'var(--qw-fg-faint)' }}>
        Pending backend projection
      </div>
      <div className="font-medium" style={{ color: 'var(--qw-fg)' }}>
        {title}
      </div>
      <div className="mt-0.5">{body}</div>
    </div>
  )
}
