import { extractorMatchesCall, patternCallNames } from './patterns'
import { validateRelationSpecs } from './relation-specs'
import type { CatalogExtractor, SourceIndexerExtension } from './types'

/**
 * Normalized, deterministic view of all extension contributions available to a compiler run.
 *
 * The registry is pure data: it does not execute extractors or retain mutable compiler state. Parser
 * code consumes it to decide which call names to scan for and which extractor should see a match.
 */
export interface ExtensionRegistry {
  readonly extensions: readonly SourceIndexerExtension[]
  readonly extractors: readonly RegisteredExtractor[]
  readonly callNames: readonly string[]
}

/**
 * Extractor paired with the extension identity that owns it.
 *
 * Keeping this pair avoids passing global extension state through extractor functions and gives
 * diagnostics/cache code enough context to identify the exact contribution that ran.
 */
export interface RegisteredExtractor {
  readonly extension: SourceIndexerExtension
  readonly extractor: CatalogExtractor
}

/**
 * Builds the immutable registry used by parser dispatch.
 *
 * Registry construction is where unordered extension manifests become deterministic compiler input:
 * extensions and extractors are sorted by name, relation specs are validated before extraction starts,
 * and call patterns are flattened into the parser prefilter. Keeping this as a pure normalization step
 * makes cache keys, diagnostics, and first-match extractor behavior reproducible.
 */
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

/**
 * Selects extractors eligible for a parsed call expression.
 *
 * The returned order is the registry's normalized order. Callers should run extractors in that order so
 * broad first-party patterns remain deterministic until import-aware matching becomes stricter.
 */
export function extractorsForCall(
  registry: ExtensionRegistry,
  callName: string,
  importSource?: string,
  importName?: string,
): readonly RegisteredExtractor[] {
  return registry.extractors.filter((item) => extractorMatchesCall(item.extractor, callName, importSource, importName))
}
