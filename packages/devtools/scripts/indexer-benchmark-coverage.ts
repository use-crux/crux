export interface NativeCoverageSummary {
  readonly kind: string
  readonly extractors?: readonly string[]
  readonly reason?: string
}

/** Formats native semantic coverage events for compact benchmark output. */
export function formatNativeCoverage(coverage: readonly NativeCoverageSummary[]): string {
  const counts = coverage.reduce<Record<string, number>>((acc, item) => {
    const detail = item.extractors?.join('+') ?? item.reason ?? 'unknown'
    const key = `${item.kind}:${detail}`
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
  return Object.entries(counts)
    .map(([key, count]) => `${key}x${count}`)
    .join(',')
}
