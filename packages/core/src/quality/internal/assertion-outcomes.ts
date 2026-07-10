/**
 * Assertion outcome helpers for the Quality engine.
 *
 * The expect runtime records matcher facts while user callbacks execute. The
 * engine later redacts those facts and stores them in the ordered
 * `assertions.outcomes` ledger.
 *
 * @internal Not exported from `@use-crux/core/quality` - engine plumbing only.
 * @module
 */

import type {
  CellAssertionExpression,
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

/** Whether an outcome makes its cell fail. */
export function isFailureOutcome(outcome: CellAssertionOutcome): boolean {
  return outcome.status === 'failed' || outcome.status === 'uncaptured'
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
  return outcomes.map((outcome) => {
    const actual = outcome.actual !== undefined ? redactAssertionValue(outcome.actual, redactPaths) : undefined
    const expected = outcome.expected !== undefined ? redactAssertionValue(outcome.expected, redactPaths) : undefined
    const expression =
      outcome.expression !== undefined
        ? redactAssertionExpression(outcome.expression, { actual, expected }, redactPaths)
        : undefined
    return {
      ...outcome,
      ...(actual !== undefined ? { actual } : {}),
      ...(expected !== undefined ? { expected } : {}),
      ...(expression !== undefined ? { expression } : {}),
    }
  })
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

function redactAssertionExpression(
  expression: CellAssertionExpression,
  values: { readonly actual?: CellAssertionValue; readonly expected?: CellAssertionValue },
  redactPaths: readonly string[],
): CellAssertionExpression {
  const left = values.actual ?? redactAssertionValue(expression.left, redactPaths)
  const right =
    expression.right !== undefined
      ? (values.expected ?? redactAssertionValue(expression.right, redactPaths))
      : undefined
  return {
    ...expression,
    left,
    ...(right !== undefined ? { right } : {}),
    rendered: renderExpression(left.preview, expression.operator, right?.preview, expression.result),
  }
}

function renderExpression(left: string, operator: string, right: string | undefined, result: boolean): string {
  return `${left}${right === undefined ? '' : ` ${operator} ${right}`} => ${String(result)}`
}

function valueChangedByRedaction(original: unknown, redacted: unknown): boolean {
  if (Object.is(original, redacted)) return false
  try {
    return canonicalJson(redacted) !== canonicalJson(original)
  } catch {
    return true
  }
}
