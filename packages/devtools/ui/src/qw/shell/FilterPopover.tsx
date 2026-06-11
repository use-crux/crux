/**
 * Shared popover-driven filter primitives.
 *
 * Two layers:
 *  - low-level building blocks (`ChipPopover`, `CheckRow`, `RadioRow`,
 *    `PopoverSection`, `AddFilterButton`) used by per-screen filter bars
 *    to compose their chip strip.
 *  - convenience presets (`MultiSelectChip`, `SingleSelectChip`,
 *    `SearchChip`) for the common "multi / single / search" shapes —
 *    screens drop these in and pass their value getter + setter.
 *
 * Filter state itself lives on `NavState` (so URLs are shareable) — these
 * components are purely presentational. The parent screen owns the
 * `RunsFilters` / `InsightsFilters` etc. and feeds the chips data +
 * callbacks.
 */

import { useState, type ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover'
import { Icon } from './Icon'

// ─── Low-level building blocks ──────────────────────────────────────

interface ChipPopoverProps {
  k: string
  value: string
  onRemove: () => void
  children: ReactNode
}

export function ChipPopover({ k, value, onRemove, children }: ChipPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-[3px] font-mono text-[11.5px]"
          style={{
            background: 'var(--qw-crux-soft)',
            border: '1px solid var(--qw-crux-line)',
            color: 'var(--qw-crux)',
          }}
        >
          <span style={{ color: 'var(--qw-crux)' }}>{k}:</span>
          <span
            className="font-medium"
            style={{
              maxWidth: 160,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {value}
          </span>
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className="opacity-70 hover:opacity-100"
            aria-label={`Remove ${k} filter`}
            style={{ color: 'var(--qw-crux)' }}
          >
            <Icon name="x" size={10} />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[260px] p-0"
        style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

export function PopoverSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div
        className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em]"
        style={{ color: 'var(--qw-fg-faint)', borderBottom: '1px solid var(--qw-border)' }}
      >
        {title}
      </div>
      <div className="py-1">{children}</div>
    </div>
  )
}

export function CheckRow({ checked, label, onClick }: { checked: boolean; label: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:opacity-90"
      style={{ color: 'var(--qw-fg)' }}
    >
      <span
        className="flex size-3.5 flex-shrink-0 items-center justify-center rounded-[3px]"
        style={{
          background: checked ? 'var(--qw-crux)' : 'transparent',
          border: `1px solid ${checked ? 'var(--qw-crux)' : 'var(--qw-border-strong)'}`,
        }}
      >
        {checked && <Icon name="check" size={9} color="var(--qw-bg)" />}
      </span>
      <span className="truncate font-mono text-[11.5px]">{label}</span>
    </button>
  )
}

export function RadioRow({ checked, label, onClick }: { checked: boolean; label: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:opacity-90"
      style={{ color: 'var(--qw-fg)' }}
    >
      <span
        className="flex size-3.5 flex-shrink-0 items-center justify-center rounded-full"
        style={{ border: `1px solid ${checked ? 'var(--qw-crux)' : 'var(--qw-border-strong)'}` }}
      >
        {checked && <span className="block size-1.5 rounded-full" style={{ background: 'var(--qw-crux)' }} />}
      </span>
      <span className="font-mono text-[11.5px]">{label}</span>
    </button>
  )
}

// ─── Convenience preset chips ───────────────────────────────────────

interface MultiSelectChipProps {
  k: string
  values: readonly string[]
  options: readonly string[]
  onChange: (next: readonly string[]) => void
  /** Pretty-print a single value (e.g. strip provider prefix). */
  format?: (v: string) => string
  emptyHint?: string
}

export function MultiSelectChip({
  k,
  values,
  options,
  onChange,
  format,
  emptyHint = 'No values yet.',
}: MultiSelectChipProps) {
  const selected = new Set(values)
  const display = values.length === 0 ? 'any' : values.map((v) => (format ? format(v) : v)).join(', ')
  return (
    <ChipPopover k={k} value={display} onRemove={() => onChange([])}>
      <PopoverSection title={`${k} · ${options.length}`}>
        <div className="max-h-[240px] overflow-auto">
          {options.length === 0 && (
            <div className="px-3 py-2 font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {emptyHint}
            </div>
          )}
          {options.map((o) => (
            <CheckRow
              key={o}
              checked={selected.has(o)}
              label={format ? format(o) : o}
              onClick={() => {
                const next = new Set(selected)
                if (next.has(o)) next.delete(o)
                else next.add(o)
                onChange(Array.from(next))
              }}
            />
          ))}
        </div>
      </PopoverSection>
    </ChipPopover>
  )
}

interface SingleSelectChipProps<V extends string> {
  k: string
  value: V | undefined
  options: ReadonlyArray<{ value: V; label: string }>
  onChange: (next: V | undefined) => void
  /** Value that means "no filter" (won't render a chip if equal). */
  noneValue?: V
  title?: string
}

export function SingleSelectChip<V extends string>({
  k,
  value,
  options,
  onChange,
  noneValue,
  title = k,
}: SingleSelectChipProps<V>) {
  const display = value ?? '—'
  return (
    <ChipPopover k={k} value={display} onRemove={() => onChange(undefined)}>
      <PopoverSection title={title}>
        {options.map((o) => (
          <RadioRow
            key={o.value}
            checked={value === o.value}
            label={o.label}
            onClick={() => onChange(o.value === noneValue ? undefined : o.value)}
          />
        ))}
      </PopoverSection>
    </ChipPopover>
  )
}

interface SearchChipProps {
  value: string | undefined
  onChange: (next: string | undefined) => void
  placeholder?: string
}

export function SearchChip({ value, onChange, placeholder = 'free text' }: SearchChipProps) {
  const [draft, setDraft] = useState(value ?? '')
  return (
    <ChipPopover k="search" value={(value ?? '').trim() || '—'} onRemove={() => onChange(undefined)}>
      <PopoverSection title="Search">
        <form
          className="flex flex-col gap-2 px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault()
            onChange(draft.trim() || undefined)
          }}
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className="rounded-[4px] px-2 py-1 font-mono text-[11.5px]"
            style={{
              background: 'var(--qw-bg)',
              border: '1px solid var(--qw-border)',
              color: 'var(--qw-fg)',
              outline: 'none',
            }}
            autoFocus
          />
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="font-mono text-[11px]"
              style={{ color: 'var(--qw-fg-faint)' }}
              onClick={() => {
                setDraft('')
                onChange(undefined)
              }}
            >
              Clear
            </button>
            <button
              type="submit"
              className="rounded-[4px] px-2 py-0.5 font-mono text-[11px]"
              style={{ background: 'var(--qw-crux)', color: 'var(--qw-bg)' }}
            >
              Apply
            </button>
          </div>
        </form>
      </PopoverSection>
    </ChipPopover>
  )
}

// ─── Add-filter dropdown button ─────────────────────────────────────
//
// Backed by shadcn DropdownMenu via QwAddFilterMenu. We keep the existing
// `AddFilterOption<K>` type + `AddFilterButton` export so the screens
// don't churn — `QwAddFilterMenu` takes the same option shape.

export type AddFilterOption<K extends string> = {
  kind: K
  label: string
  enabled: boolean
}

export { QwAddFilterMenu as AddFilterButton } from './QwMenu'

// ─── Group-by toggle (cycles through options on click) ──────────────
//
// Kept for screens that want a one-click cycle. Most screens should
// prefer GroupByDropdown for discoverability — the cycle hides the
// available options behind muscle memory.

export function GroupByCycle<G extends string>({
  value,
  cycle,
  onChange,
  noneLabel = 'off',
}: {
  value: G
  cycle: readonly G[]
  onChange: (next: G) => void
  noneLabel?: string
}) {
  return (
    <button
      onClick={() => {
        const idx = cycle.indexOf(value)
        const next = cycle[(idx + 1) % cycle.length]
        onChange(next)
      }}
      className="font-mono text-[11px] hover:opacity-80"
      style={{ color: 'var(--qw-fg-muted)' }}
    >
      group by · {value === cycle[0] ? noneLabel : value}
    </button>
  )
}

// ─── Group-by dropdown ──────────────────────────────────────────────
//
// Thin re-export of the shadcn-backed QwGroupBy so screens can keep
// importing `GroupByDropdown` from this module without knowing about
// the wrapper. New code should prefer `QwGroupBy` directly.

export { QwGroupBy as GroupByDropdown } from './QwMenu'

// ─── Collapsible group section ──────────────────────────────────────
//
// Used by Runs / Insights / Experiments to render group-by buckets as
// expandable sections. The header is always visible (showing the group
// key + summary stats); the body collapses with a single click.

export interface CollapsibleGroupProps {
  /** Unique group key — used for the React key + default expanded persistence. */
  groupKey: string
  /** Title rendered prominently on the left (e.g. the group name). */
  title: ReactNode
  /** Item count for the group; shown next to the title. */
  count?: number
  /** Right-aligned summary chips / stat cluster. */
  summary?: ReactNode
  /** Initial expanded state. Defaults to true (open). */
  defaultExpanded?: boolean
  /** Hide the collapse chrome entirely when there's only one group (e.g. group=none). */
  ungrouped?: boolean
  children: ReactNode
}

export function CollapsibleGroup({
  title,
  count,
  summary,
  defaultExpanded = true,
  ungrouped = false,
  children,
}: CollapsibleGroupProps) {
  const [open, setOpen] = useState(defaultExpanded)
  if (ungrouped) {
    return <>{children}</>
  }
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 px-8 py-2.5 text-left text-[11.5px] font-mono transition-colors hover:opacity-90"
        style={{
          background: 'var(--qw-bg-muted)',
          borderBottom: '1px solid var(--qw-border)',
          borderTop: '1px solid var(--qw-border)',
          color: 'var(--qw-fg-muted)',
        }}
      >
        <Icon name={open ? 'arrowDown' : 'arrowRight'} size={11} color="var(--qw-crux)" />
        <span className="font-semibold" style={{ color: 'var(--qw-fg)' }}>
          {title}
        </span>
        {count != null && <span style={{ color: 'var(--qw-fg-faint)' }}>· {count}</span>}
        {summary && (
          <span className="ml-auto flex items-center gap-2" style={{ color: 'var(--qw-fg-muted)' }}>
            {summary}
          </span>
        )}
      </button>
      {open && children}
    </div>
  )
}
