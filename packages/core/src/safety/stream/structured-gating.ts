/**
 * Structured occurrence gating engine (RFC #173).
 *
 * Gates the selected occurrences of a complete canonical value — the root object,
 * a scalar/string/object path, or each item of an array path — running each
 * guard once in document order. A rewrite replaces the occurrence in the
 * canonical tree copy-on-write and is validated as a locally serializable wire
 * value; a block fails closed. The returned tree is the accepted canonical input
 * from which the released structured text and the final Zod parse both derive.
 *
 * Cross-field rules and Zod effects remain final-validation gates: a locally
 * passed path never overrides them.
 *
 * @module
 */

import { selectedPath } from '../boundary'
import { SafetyStructuredSyncError } from '../errors'
import { GuardrailBlockedError } from '../guardrail/errors'
import { runGuardWithObservability } from '../guardrail/run-guard'
import type { GuardrailAudit, GuardrailContext } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'
import { streamGuardDecision } from './decision'
import { segmenterForUnit, type ResolvedTextUnit } from './segment'
import { createStructuredReadinessScanner } from '../scanner/scanner'
import { itemMatchesSelector, pathMatchesSelector, selectorSegments } from '../scanner/selector'
import type { ReadinessPath } from '../scanner/events'
import type { JsonSchemaObject } from '../../adapter/structured-output'
import { assertOccurrenceValue } from './structured-validation'

type Segment = string | number

export interface StructuredGateOptions {
  /** Guard context (with `stream.last = true`) for finalized structured output. */
  readonly guardContext: GuardrailContext
  readonly appendGuardrailAudit: (audit: GuardrailAudit) => void
  /**
   * The compiler-owned canonical (pre-lowering) schema for this call, when
   * structured output was compiled. When present, a rewrite value is validated
   * against the canonical structural node at its occurrence path before it can be
   * released — provider lowering artifacts never enter Safety semantics.
   */
  readonly canonicalSchema?: JsonSchemaObject
}

/**
 * Batch driver of the structured occurrence engine: gate every object/path/item
 * occurrence over a complete canonical value in document order and return the
 * accepted (possibly rewritten) canonical tree. Throws {@link GuardrailBlockedError}
 * on an enforcing block.
 *
 * Occurrence order is document order (via the scanner over the canonical
 * serialization), and each occurrence's full ordered guard chain runs before the
 * next occurrence — so with two bindings A and B over `items`, item 0 runs A then
 * B before item 1, never `item0/A, item1/A, item0/B`.
 */
export async function gateStructuredOccurrences(
  value: unknown,
  bindings: readonly GuardrailBinding[],
  options: StructuredGateOptions,
): Promise<unknown> {
  const occurrences = documentOrderOccurrences(value, bindings)
  let tree = value
  for (const occurrence of occurrences) {
    for (const binding of occurrence.bindings) {
      tree = await gateOccurrence(tree, occurrence.path, binding, options)
    }
  }
  return tree
}

interface Occurrence {
  readonly path: readonly Segment[]
  readonly bindings: readonly GuardrailBinding[]
}

/**
 * Produce the selected occurrences in document order. The canonical value is
 * serialized and scanned so readiness events arrive in the exact order the values
 * appear; the root object occurrence is appended last (root close).
 */
function documentOrderOccurrences(value: unknown, bindings: readonly GuardrailBinding[]): readonly Occurrence[] {
  const pathBindings = bindings.filter((binding) => selectorOf(binding).kind === 'path')
  const itemBindings = bindings.filter((binding) => selectorOf(binding).kind === 'item')
  const rootBindings = bindings.filter((binding) => selectorOf(binding).kind === 'root')

  const occurrences: Occurrence[] = []
  const scanner = createStructuredReadinessScanner()
  const events = [...scanner.write(JSON.stringify(value)), ...scanner.end().events]
  for (const event of events) {
    if (event.path.length === 0) continue // the root close is handled explicitly below
    const matched = [
      ...pathBindings.filter((binding) => pathMatchesSelector(event.path, selectorOf(binding).segments)),
      ...itemBindings.filter((binding) => itemMatchesSelector(event.path, selectorOf(binding).segments)),
    ]
    if (matched.length > 0) occurrences.push({ path: eventSegments(event.path), bindings: matched })
  }
  if (rootBindings.length > 0) occurrences.push({ path: [], bindings: rootBindings })
  return occurrences
}

export interface Selector {
  readonly kind: 'root' | 'path' | 'item'
  readonly segments: readonly string[]
}

/** The structured selector (root / scalar-or-object path / array items) for a binding. */
export function selectorOf(binding: GuardrailBinding): Selector {
  const path = selectedPath(binding.boundary)
  if (!path) return { kind: 'root', segments: [] }
  const unit = (binding.boundary as { readonly unit?: string }).unit
  return { kind: unit === 'item' ? 'item' : 'path', segments: selectorSegments(path) }
}

function eventSegments(path: ReadinessPath): readonly Segment[] {
  return path.map((segment) => segment)
}

/**
 * Gate one occurrence at `segments` with one binding — the shared core used by
 * both the batch and stream drivers: run the guard once, fail closed on block,
 * apply a copy-on-write rewrite validated as a locally serializable wire value.
 */
export async function gateOccurrence(
  tree: unknown,
  segments: readonly Segment[],
  binding: GuardrailBinding,
  options: StructuredGateOptions,
): Promise<unknown> {
  const guard = binding.policy
  const subject = segments.length === 0 ? tree : valueAt(tree, segments)

  // A string-path `.sentences()` occurrence gates each sentence of the decoded
  // string (escape-safe: the subject is already JSON-decoded) and reassembles the
  // rewritten string back into the canonical tree.
  if ((binding.boundary as { readonly unit?: string }).unit === 'sentence' && typeof subject === 'string') {
    const rewritten = await gateStringSentences(subject, binding, options)
    if (rewritten === subject) return tree
    assertOccurrenceValue(
      rewritten,
      segments,
      guard.id,
      options.canonicalSchema ? { canonicalSchema: options.canonicalSchema } : {},
    )
    return replaceAt(tree, segments, rewritten, guard.id)
  }

  const { result, entry } = await runGuardWithObservability({
    binding,
    subject,
    ctx: options.guardContext,
    phase: 'output',
    streaming: true,
    last: true,
  })
  options.appendGuardrailAudit({ applied: [entry], blocked: false })

  if (result.action === 'block') {
    if (binding.mode === 'report') return tree
    throw new GuardrailBlockedError({
      guardrailId: guard.id,
      phase: 'output',
      reason: result.reason,
      decisions: [streamGuardDecision(binding, result, '')],
    })
  }
  if (result.action === 'rewrite' && binding.mode !== 'report') {
    // Structurally validate the rewrite against the canonical schema node at this
    // occurrence path before release; a locally invalid value fails closed. Falls
    // back to bare serializability when no compiled schema is available.
    assertOccurrenceValue(result.value, segments, guard.id, {
      ...(options.canonicalSchema ? { canonicalSchema: options.canonicalSchema } : {}),
    })
    return replaceAt(tree, segments, result.value, guard.id)
  }
  return tree
}

/**
 * Gate a decoded string as a sequence of sentences: each sentence runs the guard
 * once (in order), a rewrite replaces that sentence, a block fails closed, and the
 * reassembled string is returned. The subject is already JSON-decoded, so escapes
 * are handled by re-encoding when the string is written back to the tree.
 */
async function gateStringSentences(
  subject: string,
  binding: GuardrailBinding,
  options: StructuredGateOptions,
): Promise<string> {
  const boundaryOptions = (binding.boundary as { readonly options?: ResolvedTextUnit['options'] }).options
  const resolved: ResolvedTextUnit = {
    source: 'explicit',
    unit: 'sentence',
    ...(boundaryOptions ? { options: boundaryOptions } : {}),
  }
  const segment = segmenterForUnit(resolved)
  const reportOnly = binding.mode === 'report'

  let remaining = subject
  let output = ''
  while (remaining.length > 0) {
    const sentence = segment(remaining, true)
    if (sentence === null || sentence.length === 0) {
      output += remaining
      break
    }
    remaining = remaining.slice(sentence.length)
    const { result, entry } = await runGuardWithObservability({
      binding,
      subject: sentence,
      ctx: options.guardContext,
      phase: 'output',
      streaming: true,
      last: true,
    })
    options.appendGuardrailAudit({ applied: [entry], blocked: false })

    if (result.action === 'block' && !reportOnly) {
      throw new GuardrailBlockedError({
        guardrailId: binding.policy.id,
        phase: 'output',
        reason: result.reason,
        decisions: [streamGuardDecision(binding, result, output)],
      })
    }
    output +=
      result.action === 'rewrite' && !reportOnly ? sentenceRewrite(result.value, binding.policy.id) : sentence
  }
  return output
}

/** A sentence rewrite must produce a string wire value. */
function sentenceRewrite(value: unknown, policyId: string): string {
  if (typeof value !== 'string') throw syncError(policyId, 'a sentence rewrite must be a string')
  return value
}

/** Read a value at a segment path without invoking getters or prototypes. */
export function valueAt(value: unknown, segments: readonly Segment[]): unknown {
  let current = value
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (typeof segment !== 'number') return undefined
      current = current[segment]
    } else if (isRecord(current)) {
      current = current[String(segment)]
    } else {
      return undefined
    }
  }
  return current
}

/** Copy-on-write replace at a segment path, cloning each visited ancestor once. */
function replaceAt(value: unknown, segments: readonly Segment[], replacement: unknown, policyId: string): unknown {
  if (segments.length === 0) return replacement
  const [head, ...rest] = segments
  if (Array.isArray(value)) {
    const index = Number(head)
    if (!Number.isInteger(index) || index < 0 || index >= value.length) {
      throw syncError(policyId, `cannot rewrite missing array index ${String(head)}`)
    }
    const copy = [...value]
    copy[index] = replaceAt(value[index], rest, replacement, policyId)
    return copy
  }
  if (isRecord(value)) {
    const key = String(head)
    if (!(key in value)) throw syncError(policyId, `cannot rewrite missing object path "${key}"`)
    return { ...value, [key]: replaceAt(value[key], rest, replacement, policyId) }
  }
  throw syncError(policyId, 'cannot rewrite through a non-container value')
}

function assertSerializable(value: unknown, policyId: string): void {
  let text: string | undefined
  try {
    text = JSON.stringify(value)
  } catch {
    text = undefined
  }
  if (typeof text !== 'string') throw syncError(policyId, 'rewrite produced a non-serializable wire value')
}

function syncError(policyId: string, problem: string): SafetyStructuredSyncError {
  return new SafetyStructuredSyncError({
    message: `Safety could not synchronize structured output: ${problem}.`,
    policyId,
    parseError: problem,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
