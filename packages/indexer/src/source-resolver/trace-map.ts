/**
 * Trace-map parsing and original position lookup.
 *
 * This module isolates `@jridgewell/trace-mapping` so parsing failures and
 * missing mappings are represented as typed outcomes before the resolver facade
 * adapts them back to the public compatibility shape.
 *
 * @module
 */

import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import type { TraceMapResolutionResult } from './types'

/** Parse raw source-map JSON into a `TraceMap`, returning `null` for invalid maps. */
export function parseTraceMap(mapJson: string): TraceMap | null {
  try {
    return new TraceMap(mapJson)
  } catch {
    return null
  }
}

/**
 * Resolve a generated location against an already parsed trace map.
 *
 * The returned file is the source-map source path, not normalized to an
 * absolute filesystem path.
 */
export function resolveOriginalPosition(
  traceMap: TraceMap,
  line: number,
  column: number | undefined,
): TraceMapResolutionResult {
  const pos = originalPositionFor(traceMap, { line, column: column ?? 0 })
  if (!pos.source) return { kind: 'unresolved', reason: 'original-source-missing' }
  if (!pos.line) return { kind: 'unresolved', reason: 'original-line-missing' }

  return {
    kind: 'resolved',
    file: pos.source,
    line: pos.line,
    column: pos.column ?? undefined,
    name: pos.name ?? undefined,
  }
}
