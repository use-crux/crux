/**
 * Compiler-owned canonical structural validation of a rewritten occurrence
 * (RFC #173).
 *
 * A guardrail rewrite of a structured occurrence must still fit the structural
 * slot it occupies, or the accepted canonical tree would fail the final authored
 * parse — after streamed bytes may already be released. The rewrite is checked
 * against the compiler-owned **canonical** (pre-lowering) JSON Schema node at its
 * occurrence path: a validator is compiled and cached from that node (via Zod's
 * JSON-Schema conversion, with root `$defs`/reference resolution) and only its
 * success verdict is consulted — the parsed value is never exposed or substituted.
 *
 * Provider lowering artifacts (provider-forced `required`, `additionalProperties`,
 * optional-to-nullable) are deliberately excluded: the canonical schema reflects
 * authored optionality/nullability exactly, so an authored-optional property may
 * be legitimately absent with no manifest gymnastics. Authored refinements,
 * transforms, defaults, and cross-field semantics that the canonical schema
 * cannot express stay the responsibility of the one final authored parse; this
 * check is a necessary, never a sufficient, structural gate.
 *
 * @module
 */

import { z } from 'zod'
import { SafetyStructuredSyncError } from '../errors'
import type { JsonSchemaObject } from '../../adapter/structured-output'

type Segment = string | number

export interface OccurrenceValidationContext {
  /** The compiler-owned canonical (pre-lowering) schema, when structured output was compiled. */
  readonly canonicalSchema?: JsonSchemaObject
}

// A compiled validator per canonical schema node. Keyed on the frozen node from
// the plan (stable across occurrences and calls), so the hot streaming path
// compiles each node at most once; `null` marks a node Zod could not compile.
const validatorCache = new WeakMap<JsonSchemaObject, z.ZodType | null>()

/**
 * Fail closed unless `value` is a serializable wire value that satisfies the
 * canonical schema node at `segments`. With no compiled schema (or an unreachable
 * or uncompilable node), serializability is the only gate. Throws
 * {@link SafetyStructuredSyncError} on a locally invalid rewrite.
 */
export function assertOccurrenceValue(
  value: unknown,
  segments: readonly Segment[],
  policyId: string,
  ctx: OccurrenceValidationContext,
): void {
  if (!isJsonSerializable(value)) {
    throw syncError(policyId, 'rewrite produced a non-serializable wire value')
  }
  const root = ctx.canonicalSchema
  if (!root) return
  const node = navigateCanonical(root, segments)
  if (node === undefined) return // no structural node here; serializability was the only gate
  const validator = validatorFor(node, root)
  if (validator === null) return // node not compilable to a local validator; do not false-reject
  if (!validator.safeParse(value).success) {
    throw syncError(policyId, `rewrite does not satisfy the structured schema at ${formatPath(segments)}`)
  }
}

/** Compile (and cache) a validator for a canonical node, resolving root `$defs`. */
function validatorFor(node: JsonSchemaObject, root: JsonSchemaObject): z.ZodType | null {
  const cached = validatorCache.get(node)
  if (cached !== undefined) return cached
  // Carry the document's reference targets so a `$ref` node resolves in isolation.
  const document: JsonSchemaObject = { ...node }
  if (isRecord(root.$defs) && document.$defs === undefined) document.$defs = root.$defs
  if (isRecord(root.definitions) && document.definitions === undefined) document.definitions = root.definitions
  let validator: z.ZodType | null
  try {
    validator = z.fromJSONSchema(document as never) as z.ZodType
  } catch {
    validator = null
  }
  validatorCache.set(node, validator)
  return validator
}

/** Walk the canonical schema to the node at `segments`, or `undefined` if unreachable. */
function navigateCanonical(root: JsonSchemaObject, segments: readonly Segment[]): JsonSchemaObject | undefined {
  let node: JsonSchemaObject | undefined = deref(root, root)
  for (const segment of segments) {
    if (node === undefined) return undefined
    node = unwrapForSegment(root, node, segment)
    if (typeof segment === 'number') {
      const items = asRecord(node.items)
      node = items ?? (Array.isArray(node.prefixItems) ? asRecord(node.prefixItems[segment]) : undefined)
    } else {
      const properties = asRecord(node.properties)
      node = properties ? asRecord(properties[segment]) : undefined
    }
    if (node === undefined) return undefined
    node = deref(root, node)
  }
  return node
}

/**
 * Unwrap a composed node (`anyOf`/`oneOf`, e.g. a nullable object/array) to the
 * branch that can contain `segment`, so navigation crosses nullable slots.
 */
function unwrapForSegment(root: JsonSchemaObject, node: JsonSchemaObject, segment: Segment): JsonSchemaObject {
  if (containerFor(node, segment)) return node
  const branches = Array.isArray(node.anyOf) ? node.anyOf : Array.isArray(node.oneOf) ? node.oneOf : undefined
  if (branches) {
    for (const branch of branches) {
      const record = deref(root, asRecord(branch))
      if (record && containerFor(record, segment)) return record
    }
  }
  return node
}

function containerFor(node: JsonSchemaObject | undefined, segment: Segment): boolean {
  if (!node) return false
  if (typeof segment === 'number') {
    return node.type === 'array' || asRecord(node.items) !== undefined || Array.isArray(node.prefixItems)
  }
  return node.type === 'object' || asRecord(node.properties) !== undefined
}

/** Resolve a top-level `#/$defs/Name` or `#/definitions/Name` reference against the root. */
function deref(root: JsonSchemaObject, node: JsonSchemaObject | undefined): JsonSchemaObject | undefined {
  if (!node || typeof node.$ref !== 'string') return node
  const match = /^#\/(\$defs|definitions)\/(.+)$/.exec(node.$ref)
  if (!match) return node
  const table = asRecord(root[match[1] as string])
  const target = table ? asRecord(table[decodeURIComponent(match[2] as string)]) : undefined
  return target ?? node
}

function isJsonSerializable(value: unknown): boolean {
  try {
    return typeof JSON.stringify(value) === 'string'
  } catch {
    return false
  }
}

function formatPath(segments: readonly Segment[]): string {
  return segments.length === 0 ? '<root>' : segments.join('.')
}

function asRecord(value: unknown): JsonSchemaObject | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonSchemaObject) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function syncError(policyId: string, problem: string): SafetyStructuredSyncError {
  return new SafetyStructuredSyncError({
    message: `Safety could not synchronize structured output: ${problem}.`,
    policyId,
    parseError: problem,
  })
}
