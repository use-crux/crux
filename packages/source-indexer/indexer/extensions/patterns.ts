import type { CatalogExtractor, ExtractPattern, SourceIndexerExtension } from './types'

export function callPattern(input: Omit<Extract<ExtractPattern, { kind: 'call' }>, 'kind'>): ExtractPattern {
  return { kind: 'call', ...input }
}

export function newPattern(input: Omit<Extract<ExtractPattern, { kind: 'new' }>, 'kind'>): ExtractPattern {
  return { kind: 'new', ...input }
}

export function patternCallNames(extensions: readonly SourceIndexerExtension[]): readonly string[] {
  return uniqueSorted(
    extensions.flatMap((extension) =>
      (extension.extractors ?? []).flatMap((extractor) =>
        extractor.patterns.flatMap((pattern) => (pattern.kind === 'call' ? [pattern.name] : [])),
      ),
    ),
  )
}

export function extractorMatchesCall(extractor: CatalogExtractor, callName: string): boolean {
  return extractor.patterns.some((pattern) => pattern.kind === 'call' && pattern.name === callName)
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}
