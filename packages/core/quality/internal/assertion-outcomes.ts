/**
 * Assertion outcome helpers for the Quality engine.
 *
 * The expect runtime records matcher facts while user callbacks execute. The
 * engine later redacts those facts and projects them into both the rich
 * `assertions.outcomes` ledger and the legacy `assertions.failures` view.
 *
 * @internal Not exported from `@crux/core/quality` - engine plumbing only.
 * @module
 */

import type {
  CellAssertionFailure,
  CellAssertionOutcome,
  CellAssertionPhase,
  CellAssertionValue,
} from '../experiment'
import { canonicalJson } from './json'
import { applyRedaction } from './redact'

/**
 * Minimal template captured during the counting pass for assertions that did
 * not execute in the real callback.
 */
export type NotEvaluatedAssertion = Pick<
  CellAssertionOutcome,
  'level' | 'phase' | 'matcher' | 'soft' | 'sourceRef'
>

/**
 * Build the compact preview used by assertion outcome values.
 *
 * It intentionally mirrors matcher failure previews: strings remain readable,
 * functions become a stable sentinel, and structured values use canonical JSON
 * so previews are deterministic across object key order.
 */
export function previewAssertionValue(value: unknown): string {
  if (typeof value === 'string') return value.length > 200 ? `${value.slice(0, 200)}…` : value
  if (typeof value === 'function') return '[function]'
  try {
    const rendered = canonicalJson(value)
    return rendered.length > 200 ? `${rendered.slice(0, 200)}…` : rendered
  } catch {
    return String(value)
  }
}

/**
 * Build the structured value snapshot stored on assertion outcomes.
 *
 * Matchers pass both the raw value and a bounded preview so consumers can
 * inspect the value deeply while list-style views can render a compact string.
 */
export function assertionValue(label: string, value: unknown, previewText?: string): CellAssertionValue {
  return { label, value, preview: previewText ?? previewAssertionValue(value), redacted: false }
}

/** Deterministic id for one assertion outcome within a cell. */
export function outcomeId(
  phase: CellAssertionPhase,
  level: CellAssertionOutcome['level'],
  index: number,
): string {
  return `${phase}:${level}:${index}`
}

/** Whether an outcome should appear in the legacy `assertions.failures` view. */
export function isFailureOutcome(outcome: CellAssertionOutcome): boolean {
  return outcome.status === 'failed' || outcome.status === 'uncaptured'
}

/** Convert a rich outcome into the compatibility failure projection. */
export function failureFromOutcome(outcome: CellAssertionOutcome): CellAssertionFailure {
  return {
    level: outcome.level,
    index: outcome.index,
    matcher: outcome.matcher,
    soft: outcome.soft,
    message: outcome.message ?? `${outcome.matcher} did not pass`,
    ...(outcome.expected !== undefined ? { expectedPreview: outcome.expected.preview } : {}),
    ...(outcome.actual !== undefined ? { actualPreview: outcome.actual.preview } : {}),
    ...(outcome.sourceRef !== undefined ? { sourceRef: outcome.sourceRef } : {}),
  }
}

/**
 * Apply the run's redaction policy to assertion outcome values.
 *
 * The recorder sees raw matcher values because it runs inside the user
 * callback. Redaction happens at cell assembly so outcome values and the cell
 * input/output/expected snapshots share the same privacy boundary.
 */
export function redactAssertionOutcomes(
  outcomes: readonly CellAssertionOutcome[],
  redactPaths: readonly string[],
): CellAssertionOutcome[] {
  if (outcomes.length === 0) return []
  return outcomes.map((outcome) => ({
    ...outcome,
    ...(outcome.actual !== undefined ? { actual: redactAssertionValue(outcome.actual, redactPaths) } : {}),
    ...(outcome.expected !== undefined ? { expected: redactAssertionValue(outcome.expected, redactPaths) } : {}),
  }))
}

function redactAssertionValue(value: CellAssertionValue, redactPaths: readonly string[]): CellAssertionValue {
  const redactedValue = applyRedaction(value.value, redactPaths)
  const redacted = value.redacted || valueChangedByRedaction(value.value, redactedValue)
  return {
    ...value,
    value: redactedValue,
    preview: previewAssertionValue(redactedValue),
    redacted,
  }
}

function valueChangedByRedaction(original: unknown, redacted: unknown): boolean {
  if (Object.is(original, redacted)) return false
  try {
    return canonicalJson(redacted) !== canonicalJson(original)
  } catch {
    return true
  }
}
