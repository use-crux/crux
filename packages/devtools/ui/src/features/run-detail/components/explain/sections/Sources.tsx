/**
 * "What source do I change?" — grouped definition joins (Prompt · Contexts ·
 * Retrievers · Tools · Routing · Guardrails · Constraints · Quality). Each row
 * carries the join status + fidelity and, when resolved, a file:line the user
 * can open. Unresolved is a real, honest state — never a blank row.
 */

import { Icon } from '@/qw/shell/Icon'
import type { TurnSourceGroup, TurnSourceJoin } from '@/types'
import { SourceFidelityTag, SourceStatusTag } from '../atoms'

function fileLabel(item: TurnSourceJoin): string {
  if (!item.file) return 'unresolved'
  const base = item.file.split('/').pop() ?? item.file
  return item.line != null ? `${base}:${item.line}` : base
}

function SourceRow({ item }: { item: TurnSourceJoin }) {
  const label = item.name ?? item.id ?? item.kind ?? 'definition'
  return (
    <div className="flex items-center gap-[9px] px-3 py-2" style={{ borderBottom: '1px solid var(--qw-border)' }}>
      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px]" style={{ color: 'var(--qw-fg)' }} title={label}>
        {label}
      </span>
      <span
        className="hidden min-w-0 max-w-[140px] truncate font-mono text-[10px] sm:inline"
        style={{ color: item.file ? 'var(--qw-fg-muted)' : 'var(--qw-fg-faint)' }}
      >
        {fileLabel(item)}
      </span>
      <SourceStatusTag status={item.status} />
      <SourceFidelityTag fidelity={item.fidelity} />
      {item.file && <Icon name="link" size={12} color="var(--qw-fg-faint)" />}
    </div>
  )
}

export function SourceGroups({ groups }: { groups: readonly TurnSourceGroup[] }) {
  if (groups.length === 0) {
    return (
      <div
        className="rounded-[10px] px-3.5 py-3 text-[12px]"
        style={{ border: '1px solid var(--qw-border)', color: 'var(--qw-fg-faint)' }}
      >
        No source definition was resolved for this turn.
      </div>
    )
  }
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
      {groups.map((g) => (
        <div
          key={g.group}
          className="overflow-hidden rounded-[10px]"
          style={{ background: 'var(--qw-bg)', border: '1px solid var(--qw-border)' }}
        >
          <div
            className="px-3 py-[7px] font-mono text-[10px] uppercase tracking-[0.1em]"
            style={{ borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-bg-elev)', color: 'var(--qw-fg-faint)' }}
          >
            {g.group}
          </div>
          {g.items.length === 0 ? (
            <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              No source definition was resolved for this item.
            </div>
          ) : (
            g.items.map((item, i) => <SourceRow key={item.id ?? i} item={item} />)
          )}
        </div>
      ))}
    </div>
  )
}
