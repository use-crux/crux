import type { ChipTone } from '@/qw/shell/primitives'
import type { RuntimeWorkFilters, RuntimeWorkRow, RuntimeWorkStatus } from '../types'

export function filterRuntimeWork(
  rows: readonly RuntimeWorkRow[],
  filters: RuntimeWorkFilters,
): readonly RuntimeWorkRow[] {
  return rows.filter((row) => {
    if (filters.status && filters.status !== 'all' && row.status !== filters.status) return false
    if (filters.namespace && row.namespace !== filters.namespace) return false
    if (filters.targetId && row.targetId !== filters.targetId) return false
    return true
  })
}

export function runtimeStatusTone(status: RuntimeWorkStatus): ChipTone {
  switch (status) {
    case 'completed':
      return 'ok'
    case 'blocked':
    case 'dead-letter':
      return 'danger'
    case 'leased':
    case 'pending':
      return 'crux'
    case 'suspended':
      return 'warn'
    case 'cancelled':
      return 'muted'
  }
}

export function fmtRuntimeDate(value: string | undefined): string {
  if (!value) return '-'
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return '-'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(time)
}

export function distinctSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(codepointCompare)
}

function codepointCompare(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}
