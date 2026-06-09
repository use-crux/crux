import type { IndexExtractor, ExtractPattern, IndexerExtension } from './types'

/**
 * Creates a call-expression pattern for an extractor manifest.
 *
 * The pattern is declarative data used by the compiler registry and parser prefilter. The static
 * parser first matches by callee name, applies `importFrom` when provided, then uses `configArg`
 * to expose a non-leading object argument through `ctx.config`.
 */
export function callPattern(
  input: Omit<Extract<ExtractPattern, { kind: 'call' }>, 'kind'>,
): Extract<ExtractPattern, { kind: 'call' }> {
  return { kind: 'call', ...input }
}

/**
 * Creates a constructor-call pattern for an extractor manifest.
 *
 * Constructor patterns are routed through the same immutable extraction contract as normal calls.
 * `importFrom` is part of the declaration even though constructor import checks are still parser-owned.
 */
export function newPattern(
  input: Omit<Extract<ExtractPattern, { kind: 'new' }>, 'kind'>,
): Extract<ExtractPattern, { kind: 'new' }> {
  return { kind: 'new', ...input }
}

/**
 * Computes the call-name prefilter used by static parsing.
 *
 * Returning a sorted unique list makes the registry deterministic across Node versions and import
 * order. Deterministic registry output matters because extension identity participates in parser cache
 * keys and because first-match extractor execution should be reproducible.
 */
export function patternCallNames(extensions: readonly IndexerExtension[]): readonly string[] {
  return uniqueSorted(
    extensions.flatMap((extension) =>
      (extension.extractors ?? []).flatMap((extractor) =>
        extractor.patterns.flatMap((pattern) =>
          pattern.kind === 'call' || pattern.kind === 'new' ? [pattern.name] : [],
        ),
      ),
    ),
  )
}

/**
 * Checks whether a normalized extractor can handle a parsed call expression.
 *
 * This is intentionally narrower than full pattern matching. Bare patterns match the local call name.
 * Patterns with `importFrom` require the parser to resolve the callee to a matching module specifier
 * and compare the pattern against the imported symbol name, so renamed imports still work.
 */
export function extractorMatchesCall(
  extractor: IndexExtractor,
  callName: string,
  importSource?: string,
  importName?: string,
): boolean {
  return extractor.patterns.some(
    (pattern) =>
      pattern.kind === 'call' &&
      pattern.name === (pattern.importFrom ? (importName ?? callName) : callName) &&
      (!pattern.importFrom || (importSource !== undefined && pattern.importFrom.includes(importSource))),
  )
}

/**
 * Checks whether a normalized extractor can handle a parsed constructor expression.
 */
export function extractorMatchesNew(extractor: IndexExtractor, constructorName: string): boolean {
  return extractor.patterns.some((pattern) => pattern.kind === 'new' && pattern.name === constructorName)
}

/**
 * Checks whether a normalized extractor can handle a parsed object literal expression.
 */
export function extractorMatchesObject(extractor: IndexExtractor): boolean {
  return extractor.patterns.some((pattern) => pattern.kind === 'object')
}

/** Normalizes unordered pattern names so registry output is stable across process runs. */
function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}
