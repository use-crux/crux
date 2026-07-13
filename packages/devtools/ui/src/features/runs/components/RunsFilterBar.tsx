/**
 * Filter chip bar for the Runs list. Thin wrapper over the shared
 * chip primitives in `qw/shell/FilterPopover.tsx` — handles which kinds
 * are currently active and how to seed them.
 *
 * Filter state lives on `NavState` (URL-shareable) — `onChange` pushes
 * the next snapshot up; the parent calls `navigate({ view: 'runs', ... })`.
 */

import { type ReactNode } from 'react'
import { Icon } from '@/qw/shell/Icon'
import {
  AddFilterButton,
  MultiSelectChip,
  SingleSelectChip,
  SearchChip,
  type AddFilterOption,
} from '@/qw/shell/FilterPopover'
import type { RunsFilters } from '../types'
export type { RunsFilters } from '../types'

interface RunsFilterBarProps {
  filters: RunsFilters
  onChange: (next: RunsFilters) => void
  distinctTargets: readonly string[]
  distinctModels: readonly string[]
  right?: ReactNode
}

// Full run/span status vocabulary the backend filters on (canonical `ok`, not
// `success`). Matches the design's status pill set, plus `conflicted` (spec
// 04 §1: an immutable-identity/terminal-evidence conflict on a logical run).
const STATUS_OPTIONS = [
  'running',
  'ok',
  'error',
  'blocked',
  'cancelled',
  'suspended',
  'skipped',
  'incomplete',
  'conflicted',
  'stale',
]
const LAST_OPTIONS = [
  { value: 'all' as const, label: 'All time' },
  { value: '1h' as const, label: 'Last hour' },
  { value: '24h' as const, label: 'Last 24h' },
  { value: '7d' as const, label: 'Last 7 days' },
  { value: '30d' as const, label: 'Last 30 days' },
]
const HAS_OPTIONS = [
  { value: 'feedback' as const, label: 'Feedback' },
  { value: 'experiment' as const, label: 'Experiment' },
]

type FilterKind = 'status' | 'target' | 'model' | 'last' | 'has' | 'search'

export function RunsFilterBar({ filters, onChange, distinctTargets, distinctModels, right }: RunsFilterBarProps) {
  const activeKinds = new Set<FilterKind>()
  if (filters.status && filters.status.length > 0) activeKinds.add('status')
  if (filters.target && filters.target.length > 0) activeKinds.add('target')
  if (filters.model && filters.model.length > 0) activeKinds.add('model')
  if (filters.last && filters.last !== 'all') activeKinds.add('last')
  if (filters.has) activeKinds.add('has')
  if (filters.search) activeKinds.add('search')

  function update<K extends keyof RunsFilters>(key: K, value: RunsFilters[K]) {
    const next: RunsFilters = { ...filters }
    if (value == null || (Array.isArray(value) && value.length === 0) || value === 'all' || value === '') {
      delete next[key]
    } else {
      next[key] = value
    }
    onChange(next)
  }

  const addOptions: ReadonlyArray<AddFilterOption<FilterKind>> = [
    { kind: 'status', label: 'Status', enabled: !activeKinds.has('status') },
    { kind: 'target', label: 'Target', enabled: !activeKinds.has('target') && distinctTargets.length > 0 },
    { kind: 'model', label: 'Model', enabled: !activeKinds.has('model') && distinctModels.length > 0 },
    { kind: 'last', label: 'Time window', enabled: !activeKinds.has('last') },
    { kind: 'has', label: 'Has feedback / experiment', enabled: !activeKinds.has('has') },
    { kind: 'search', label: 'Search', enabled: !activeKinds.has('search') },
  ]

  return (
    <div
      className="flex flex-shrink-0 flex-wrap items-center gap-1.5 px-8 py-2"
      style={{ borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-bg)' }}
    >
      <div
        className="mr-1 flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em]"
        style={{ color: 'var(--qw-fg-faint)' }}
      >
        <Icon name="filter" size={11} />
        filter
      </div>

      {activeKinds.has('target') && (
        <MultiSelectChip
          k="target"
          values={filters.target ?? []}
          options={distinctTargets}
          onChange={(next) => update('target', next.length > 0 ? next : undefined)}
        />
      )}
      {activeKinds.has('status') && (
        <MultiSelectChip
          k="status"
          values={filters.status ?? []}
          options={STATUS_OPTIONS}
          onChange={(next) => update('status', next.length > 0 ? next : undefined)}
        />
      )}
      {activeKinds.has('model') && (
        <MultiSelectChip
          k="model"
          values={filters.model ?? []}
          options={distinctModels}
          onChange={(next) => update('model', next.length > 0 ? next : undefined)}
          format={(m) => m.split('/').pop() ?? m}
        />
      )}
      {activeKinds.has('last') && (
        <SingleSelectChip
          k="last"
          value={filters.last}
          options={LAST_OPTIONS}
          onChange={(v) => update('last', v)}
          noneValue="all"
          title="Time window"
        />
      )}
      {activeKinds.has('has') && (
        <SingleSelectChip
          k="has"
          value={filters.has}
          options={HAS_OPTIONS}
          onChange={(v) => update('has', v)}
          title="Has"
        />
      )}
      {activeKinds.has('search') && (
        <SearchChip
          value={filters.search}
          onChange={(v) => update('search', v)}
          placeholder="traceId / target / input text"
        />
      )}

      <AddFilterButton
        options={addOptions}
        onAdd={(kind) => {
          if (kind === 'status') update('status', ['error'])
          else if (kind === 'target' && distinctTargets[0]) update('target', [distinctTargets[0]])
          else if (kind === 'model' && distinctModels[0]) update('model', [distinctModels[0]])
          else if (kind === 'last') update('last', '24h')
          else if (kind === 'has') update('has', 'feedback')
          else if (kind === 'search') update('search', ' ')
        }}
      />

      <div className="flex-1" />
      {right}
    </div>
  )
}
