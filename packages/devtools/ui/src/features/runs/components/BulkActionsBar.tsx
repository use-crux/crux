import { Btn } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'

interface BulkActionsBarProps {
  count: number
  busy: boolean
  onCancel: () => void
  onDelete: () => void
}

export function BulkActionsBar({ count, busy, onCancel, onDelete }: BulkActionsBarProps) {
  return (
    <div
      className="sticky top-0 z-20 flex items-center gap-3 px-8 py-2 font-mono text-[12px]"
      style={{
        background: 'var(--qw-crux-soft)',
        borderBottom: '1px solid var(--qw-crux-line)',
        color: 'var(--qw-crux)',
      }}
    >
      <span className="font-semibold">
        {count} run{count === 1 ? '' : 's'} selected
      </span>
      <button
        type="button"
        onClick={onCancel}
        className="font-mono text-[11px] hover:opacity-80"
        style={{ color: 'var(--qw-fg-muted)' }}
        disabled={busy}
      >
        Cancel
      </button>
      <div className="flex-1" />
      <Btn size="xs" variant="danger" icon={<Icon name="x" size={11} />} onClick={onDelete} disabled={busy}>
        {busy ? 'Deleting...' : `Delete ${count}`}
      </Btn>
    </div>
  )
}
