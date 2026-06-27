import type { StaticExtractionTiming } from '@use-crux/indexer'

/** Aggregates static extraction timing events into worker protocol buckets. */
export function createStaticTimingCollector(): {
  readonly instrumentation: { readonly onTiming: (timing: StaticExtractionTiming) => void }
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

/** Returns the provided-record cache size requested by worker environment. */
export function providedRecordCacheSizeFromEnv(): number | undefined {
  const value = process.env.CRUX_INDEXER_PROVIDED_RECORD_CACHE_SIZE
  if (!value || value.trim() === '') {
    return process.env.CRUX_INDEXER_MEMORY_PROFILE?.toLowerCase() === 'low-rss' ? 128 : undefined
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}
