import type { SemanticIndexTiming } from '@use-crux/indexer'

/** Aggregates semantic indexing timing and counter events into worker protocol buckets. */
export function createSemanticTimingCollector(): {
  readonly instrumentation: { readonly onTiming: (timing: SemanticIndexTiming) => void }
  readonly summary: () => readonly { readonly name: string; readonly durationMs: number; readonly count: number }[]
} {
  const timings = new Map<string, { durationMs: number; count: number }>()
  return {
    instrumentation: {
      onTiming: (timing) => {
        const current = timings.get(timing.name) ?? { durationMs: 0, count: 0 }
        current.durationMs += timing.durationMs
        current.count += 1
        timings.set(timing.name, current)
      },
    },
    summary: () =>
      [...timings]
        .map(([name, timing]) => ({
          name,
          durationMs: timing.durationMs,
          count: timing.count,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
  }
}
