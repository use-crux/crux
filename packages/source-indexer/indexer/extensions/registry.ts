import { extractorMatchesCall, patternCallNames } from './patterns'
import { validateRelationSpecs } from './relation-specs'
import type { CatalogExtractor, SourceIndexerExtension } from './types'

export interface ExtensionRegistry {
  readonly extensions: readonly SourceIndexerExtension[]
  readonly extractors: readonly RegisteredExtractor[]
  readonly callNames: readonly string[]
}

export interface RegisteredExtractor {
  readonly extension: SourceIndexerExtension
  readonly extractor: CatalogExtractor
}

export function createExtensionRegistry(extensions: readonly SourceIndexerExtension[]): ExtensionRegistry {
  const normalizedExtensions = [...extensions].sort((a, b) => a.name.localeCompare(b.name))
  const relationSpecErrors = validateRelationSpecs(normalizedExtensions.flatMap((extension) => extension.relations ?? []))
  if (relationSpecErrors.length > 0) {
    throw new Error(`Invalid source indexer relation specs:\n${relationSpecErrors.join('\n')}`)
  }
  const extractors = normalizedExtensions.flatMap((extension) =>
    [...(extension.extractors ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((extractor) => ({ extension, extractor })),
  )
  return {
    extensions: normalizedExtensions,
    extractors,
    callNames: patternCallNames(normalizedExtensions),
  }
}

export function extractorsForCall(registry: ExtensionRegistry, callName: string): readonly RegisteredExtractor[] {
  return registry.extractors.filter((item) => extractorMatchesCall(item.extractor, callName))
}
