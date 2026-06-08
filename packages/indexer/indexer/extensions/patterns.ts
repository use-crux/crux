import type { IndexExtractor, ExtractPattern, IndexerExtension } from './types'

/**
 * Creates a call-expression pattern for an extractor manifest.
 *
 * The pattern is declarative data used by the compiler registry and parser prefilter. In v1 the static
 * parser first matches by callee name, then applies `importFrom` when provided. `configArg` remains
 * manifest metadata for parser support where the config object is not the first argument.
 */
export function callPattern(input: Omit<Extract<ExtractPattern, { kind: 'call' }>, 'kind'>): ExtractPattern {
  return { kind: 'call', ...input }
}

/**
 * Creates a constructor-call pattern for an extractor manifest.
 *
 * Constructor patterns are routed through the same immutable extraction contract as normal calls.
 * `importFrom` is part of the declaration even though constructor import checks are still parser-owned.
 */
export function newPattern(input: Omit<Extract<ExtractPattern, { kind: 'new' }>, 'kind'>): ExtractPattern {
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
        extractor.patterns.flatMap((pattern) => (pattern.kind === 'call' ? [pattern.name] : [])),
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

/** Normalizes unordered pattern names so registry output is stable across process runs. */
function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}
