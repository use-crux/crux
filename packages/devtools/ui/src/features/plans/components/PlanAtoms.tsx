import { Icon } from '@/qw/shell/Icon'

export function KindBadge({
  name,
  color,
  size = 22,
}: {
  name: Parameters<typeof Icon>[0]['name']
  color?: string
  size?: number
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-[6px]"
      style={{
        width: size,
        height: size,
        background: 'var(--qw-bg-muted)',
        boxShadow: 'inset 0 0 0 1px var(--qw-border)',
      }}
    >
      <Icon name={name} size={Math.round(size * 0.55)} color={color ?? 'var(--qw-fg-muted)'} />
    </div>
  )
}

export function Checkbox({ done }: { done: boolean }) {
  return (
    <span
      className="flex size-[14px] items-center justify-center rounded-[3px]"
      style={{
        background: done ? 'var(--qw-ok)' : 'var(--qw-bg)',
        boxShadow: `inset 0 0 0 1px ${done ? 'var(--qw-ok)' : 'var(--qw-border-strong)'}`,
      }}
    >
      {done && <Icon name="check" size={9} color="var(--qw-bg)" />}
    </span>
  )
}

export function ProgressBar({ percent, color }: { percent: number; color: string }) {
  return (
    <div className="h-[5px] flex-1 overflow-hidden rounded-full" style={{ background: 'var(--qw-bg-muted)' }}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%`, background: color }}
      />
    </div>
  )
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
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
