/**
 * Constraint occurrence selection (RFC #173).
 *
 * Constraints share the guardrail selection model: a constraint resolves the same
 * selected occurrences its boundary would gate — the whole text, the composite
 * `{ text, object }`, the root object, a scalar/object path, or each item of an
 * array path. A constraint is checked over each selected occurrence in order and
 * fails on the first occurrence that fails, so a later array item cannot pass a
 * constraint that an earlier item already failed. A boundary that selects no
 * occurrence (a missing optional path) is vacuously satisfied.
 *
 * @module
 */

import { selectedPath } from '../boundary'
import { selectorSegments } from '../scanner/selector'
import type { ConstraintBoundary } from './boundary'

type Segment = string | number

/** One selected occurrence: its identity path and its subject value. */
export interface ConstraintOccurrenceEntry {
  /** Occurrence identity: the object path (with an array index for `.items()`), or `[]`. */
  readonly occurrence: readonly Segment[]
  readonly subject: unknown
}

/**
 * The constraint's selected occurrence entries (identity path + subject), in
 * document order. The identity path is the same one settlement records and the
 * terminal runner matches against, so a stream-settled occurrence can be located
 * precisely — a `.items()` array yields one entry per item (path + index).
 */
export function constraintOccurrenceEntries(
  boundary: ConstraintBoundary,
  output: { readonly text: string; readonly parsed?: unknown },
): readonly ConstraintOccurrenceEntry[] {
  if (boundary.id === 'model.output') return [{ occurrence: [], subject: { text: output.text, object: output.parsed } }]
  if (boundary.id === 'model.output.object') {
    const path = selectedPath(boundary)
    if (!path) return [{ occurrence: [], subject: output.parsed }] // root object
    const segments = selectorSegments(path)
    const value = valueAt(output.parsed, segments)
    const unit = (boundary as { readonly unit?: string }).unit
    if (unit === 'item') {
      return Array.isArray(value)
        ? value.map((item, index) => ({ occurrence: [...segments, index], subject: item }))
        : value === undefined
          ? []
          : [{ occurrence: segments, subject: value }]
    }
    // Scalar/object path; missing optional → no occurrence.
    return value === undefined ? [] : [{ occurrence: segments, subject: value }]
  }
  // `model.output.text` and any text-like boundary.
  return [{ occurrence: [], subject: output.text }]
}

/** The constraint's selected occurrence subjects, in document order. */
export function constraintOccurrences(
  boundary: ConstraintBoundary,
  output: { readonly text: string; readonly parsed?: unknown },
): readonly unknown[] {
  return constraintOccurrenceEntries(boundary, output).map((entry) => entry.subject)
}

/** Read a value at a segment path without invoking getters or prototypes. */
function valueAt(value: unknown, segments: readonly Segment[]): unknown {
  let current = value
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index)) return undefined
      current = current[index]
    } else if (isRecord(current)) {
      current = current[String(segment)]
    } else {
      return undefined
    }
  }
  return current
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
