import { useState } from 'react'
import { Chip, type ChipTone } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'

interface PlanCardProps {
  planId: string
  title: string
  contentPreview: string
  version: number
  status: string
  timestamp: number
}

const STATUS_TONE: Record<string, ChipTone> = {
  draft: 'muted',
  approved: 'crux',
  executing: 'warn',
  completed: 'ok',
  rejected: 'danger',
}

function formatTs(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function PlanCard({
  planId,
  title,
  contentPreview,
  version,
  status,
  timestamp,
}: PlanCardProps) {
  const [open, setOpen] = useState(false)
  const tone = STATUS_TONE[status] ?? 'muted'
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-opacity hover:opacity-90"
      >
        <Icon
          name={open ? 'arrowDown' : 'arrowRight'}
          size={12}
          color="var(--qw-fg-faint)"
        />
        <span
          className="truncate text-[13px] font-medium"
          style={{ color: 'var(--qw-fg)' }}
        >
          {title}
        </span>
        <Chip tone="muted" mono>
          v{version}
        </Chip>
        <Chip tone={tone}>{status}</Chip>
        <span
          className="ml-auto font-mono text-[10.5px] tabular-nums"
          style={{ color: 'var(--qw-fg-faint)' }}
        >
          {formatTs(timestamp)}
        </span>
      </button>

      {open && (
        <div
          className="px-3 py-2.5"
          style={{ borderTop: '1px solid var(--qw-border)' }}
        >
          {contentPreview && (
            <div
              className="whitespace-pre-wrap break-words text-[12px] leading-[1.55]"
              style={{ color: 'var(--qw-fg-muted)', fontFamily: 'var(--qw-serif)' }}
            >
              {contentPreview}
            </div>
          )}
          <div
            className="mt-2 flex items-center gap-3 font-mono text-[10.5px]"
            style={{ color: 'var(--qw-fg-faint)' }}
          >
            <span>{planId.slice(0, 8)}</span>
            <span>version {version}</span>
            <span>{new Date(timestamp).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  )
}
