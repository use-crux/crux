import type { RegisteredExtractor } from './registry'
import type { StaticExtractionResult } from './runtime'
import type { ExtensionIdentity, ExtractResult, IndexDependency, IndexerExtension } from './types'

/**
 * Converts an extractor return value into the normalized runtime result shape.
 *
 * Runtime results always include extension/extractor identity and dependency inputs, even when the
 * extractor emits no facts. That keeps cache invalidation and diagnostics tied to the code that made
 * the decision.
 */
export function runtimeResultFromExtractResult(
  item: RegisteredExtractor,
  result: ExtractResult,
): Exclude<StaticExtractionResult, { readonly kind: 'no-match' }> {
  const identity = extensionIdentity(item.extension)
  const dependencies = runtimeDependencies(item, result.dependencies)
  switch (result.kind) {
    case 'facts':
      return {
        kind: 'matched',
        extension: identity,
        extractor: item.extractor.name,
        facts: result.facts,
        dependencies,
        diagnostics: [],
      }
    case 'none':
      return {
        kind: 'none',
        extension: identity,
        extractor: item.extractor.name,
        dependencies,
        diagnostics: [],
      }
    case 'degraded':
      return {
        kind: 'degraded',
        extension: identity,
        extractor: item.extractor.name,
        ...(result.facts ? { facts: result.facts } : {}),
        dependencies,
        diagnostics: [...result.diagnostics],
      }
    default:
      return assertNever(result)
  }
}

/** Adds extension/extractor identity dependencies to extractor-declared dependencies. */
export function runtimeDependencies(
  item: RegisteredExtractor,
  declared: readonly IndexDependency[] | undefined,
): readonly IndexDependency[] {
  return [
    { kind: 'extension', name: item.extension.name, version: item.extension.version },
    { kind: 'extractor', extension: item.extension.name, name: item.extractor.name },
    ...(declared ?? []),
  ]
}

/** Returns the stable extension identity used in diagnostics and cache inputs. */
export function extensionIdentity(extension: IndexerExtension): ExtensionIdentity {
  return { name: extension.name, version: extension.version }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled extension runtime result: ${JSON.stringify(value)}`)
}
