/**
 * Freshness fact helpers for resolved context contributions.
 *
 * The resolver records facts, not policy: these helpers stamp where a
 * contribution was served from, when it was originally resolved, how old a
 * memo hit is, and the oldest source-observation timestamp carried by
 * structured segments.
 *
 * @module
 */

import type { ContextTextSegment } from '../prompt/context-types'
import type { ResolvedSystemContent } from './contract'

/** Where a context contribution was served from during this resolution. */
export type FreshnessServedFrom = 'live' | 'memo'

/** Time-provenance facts attached to a resolved context contribution. */
export interface FreshnessRecord {
  /** Whether this resolution ran the context live or reused resolver memo output. */
  servedFrom: FreshnessServedFrom
  /** Clock timestamp for the original context resolution. */
  resolvedAt: number
  /** Age in milliseconds for memo hits. Omitted for live resolutions. */
  age?: number
}

/** Segment-derived source facts summarized at the part/artifact level. */
export interface SourceFreshnessRecord {
  /** Oldest source-observation timestamp among the contribution's segments. */
  observedAt?: number
  /** First source version reported by the contribution's segments. */
  sourceVersion?: string
}

/** Add live freshness facts to freshly resolved system content. */
export function markLive(content: ResolvedSystemContent, resolvedAt: number): ResolvedSystemContent {
  return { ...content, servedFrom: 'live', resolvedAt }
}

/** Add memo freshness facts while preserving the original resolution time. */
export function markMemo(
  content: ResolvedSystemContent,
  input: { ageMs: number; now: number },
): ResolvedSystemContent {
  const resolvedAt = typeof content.resolvedAt === 'number' ? content.resolvedAt : input.now - input.ageMs
  return { ...content, servedFrom: 'memo', resolvedAt, age: input.ageMs }
}

/** Project optional freshness fields onto inspect parts and artifact previews. */
export function freshnessProjection(
  content: ResolvedSystemContent | SourceFreshnessRecord,
): Partial<FreshnessRecord & SourceFreshnessRecord> {
  return {
    ...('servedFrom' in content && content.servedFrom ? { servedFrom: content.servedFrom } : {}),
    ...('resolvedAt' in content && typeof content.resolvedAt === 'number' ? { resolvedAt: content.resolvedAt } : {}),
    ...('age' in content && typeof content.age === 'number' ? { age: content.age } : {}),
    ...('observedAt' in content && typeof content.observedAt === 'number' ? { observedAt: content.observedAt } : {}),
    ...('sourceVersion' in content && typeof content.sourceVersion === 'string'
      ? { sourceVersion: content.sourceVersion }
      : {}),
  }
}

/** Summarize precise segment-level source facts onto the enclosing part. */
export function summarizeSegmentFreshness(
  segments: readonly ContextTextSegment[] | undefined,
): SourceFreshnessRecord {
  if (!segments || segments.length === 0) return {}

  let observedAt: number | undefined
  let sourceVersion: string | undefined
  for (const segment of segments) {
    if (typeof segment.observedAt === 'number') {
      observedAt = observedAt === undefined ? segment.observedAt : Math.min(observedAt, segment.observedAt)
    }
    if (sourceVersion === undefined && typeof segment.sourceVersion === 'string') {
      sourceVersion = segment.sourceVersion
    }
  }
  return {
    ...(observedAt !== undefined ? { observedAt } : {}),
    ...(sourceVersion !== undefined ? { sourceVersion } : {}),
  }
}
