import type {
  RuntimePruneOptions,
  RuntimePruneResult,
} from '../../ports/retention'

export function pruneArray<T>(
  records: T[],
  options: RuntimePruneOptions,
  eligible: (record: T) => boolean,
  onRemove?: (record: T) => void,
): RuntimePruneResult {
  const limit = normalizedLimit(options.limit)
  const eligibleRecords = records.filter(eligible)
  const selected = new Set(eligibleRecords.slice(0, limit))
  if (selected.size > 0) {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index]
      if (record !== undefined && selected.has(record)) {
        onRemove?.(record)
        records.splice(index, 1)
      }
    }
  }
  return { removed: selected.size, truncated: eligibleRecords.length > limit }
}

export function pruneMapValues<K, T>(
  records: Map<K, T>,
  options: RuntimePruneOptions,
  eligible: (record: T) => boolean,
  onRemove?: (record: T) => void,
): RuntimePruneResult {
  const limit = normalizedLimit(options.limit)
  const eligibleEntries = [...records.entries()].filter(([, record]) =>
    eligible(record),
  )
  const selected = eligibleEntries.slice(0, limit)
  for (const [key, record] of selected) {
    records.delete(key)
    onRemove?.(record)
  }
  return { removed: selected.length, truncated: eligibleEntries.length > limit }
}

export function matchesPruneNamespace(
  record: { readonly namespace: string },
  namespace: string | undefined,
): boolean {
  return namespace === undefined || record.namespace === namespace
}

export function olderThan(date: Date | undefined, cutoff: Date): boolean {
  return date === undefined || date.getTime() < cutoff.getTime()
}

function normalizedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 0
  return Math.max(0, Math.trunc(limit))
}
