import type { ExtractedDefinition, ExtractedFacts, ExtractResult } from './types'

/**
 * Returns a successful extractor result containing immutable catalog facts.
 *
 * This helper is intentionally small: an extractor should build plain definition/reference/source-ref
 * values and hand them back to the compiler instead of mutating a graph or appending to shared
 * collections. Resolver, rule, and emitter stages decide how those values become catalog relations,
 * diagnostics, snapshots, or patches.
 *
 * @example
 * ```ts
 * return facts({
 *   definitions: [ctx.define.definition({ variableName, id, kind: 'tool', name })],
 *   references: [ctx.ref.variable('agent.uses_tool', 'writerTool')],
 * })
 * ```
 */
export function facts(input: ExtractedFacts): Extract<ExtractResult, { kind: 'facts' }> {
  return { kind: 'facts', facts: input }
}

/**
 * Copies an existing definition contribution into a fresh value.
 *
 * Use this when an extractor receives a compiler-owned `ExtractedDefinition` and wants to forward it
 * without retaining caller-owned array references. It is primarily useful in tests and normalizer code;
 * ordinary extractors should prefer `ctx.define.definition(...)`.
 */
export function projectDefinition(input: ExtractedDefinition): ExtractedDefinition {
  return {
    variableName: input.variableName,
    definition: input.definition,
    ...(input.extraDefinitions ? { extraDefinitions: [...input.extraDefinitions] } : {}),
  }
}

/**
 * Returns a successful no-op extractor result.
 *
 * `none()` is different from an error: it means the extractor matched a broad source pattern but the
 * specific source shape is not catalog-relevant. This keeps extractors total and predictable, which is
 * important for deterministic static parsing and cache reuse.
 */
export function none(): Extract<ExtractResult, { kind: 'none' }> {
  return { kind: 'none' }
}
