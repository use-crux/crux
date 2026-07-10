import type { IndexPatchFacts } from '../../indexer/patches'
import { canonicalParityJson } from './json'

/**
 * Serializes `IndexPatchFacts` for TS/Rust/Go parity gates.
 *
 * The normalizer compares every `IndexPatchFacts` surface and fails closed on
 * unknown semantic fields. It only removes ordering and path-separator noise
 * documented by the native AST parity contract.
 */
export function canonicalIndexPatchFactsJson(facts: IndexPatchFacts): string {
  return canonicalParityJson(facts, { root: 'indexPatchFacts' })
}

/**
 * Serializes a single-file static extraction projection for frontend parity.
 *
 * Static extraction parity is a narrower surface than a full patch: definitions,
 * relations, diagnostics, and direct source dependencies.
 */
export function canonicalStaticExtractionJson(facts: {
  readonly definitions: IndexPatchFacts['definitions']
  readonly relations: IndexPatchFacts['relations']
  readonly diagnostics: IndexPatchFacts['diagnostics']
  readonly dependencies: readonly string[]
}): string {
  return canonicalParityJson(facts, { root: 'staticExtraction' })
}

