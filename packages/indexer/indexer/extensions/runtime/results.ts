import type { RegisteredExtractor } from './registry'
import type { StaticExtractionResult } from './engine'
import type { IndexDiagnostic } from '@use-crux/core/project-index'
import { extractorFailedDiagnostic, extractorResultInvalidDiagnostic } from './diagnostics'
import type { ExtensionIdentity, ExtractedFacts, ExtractResult, IndexDependency, IndexerExtension } from '../public-contract/types'

/**
 * Converts an extractor return value into the normalized runtime result shape.
 *
 * Runtime results always include extension/extractor identity and dependency inputs, even when the
 * extractor emits no facts. That keeps cache invalidation and diagnostics tied to the code that made
 * the decision.
 */
export function runtimeResultFromExtractResult(
  item: RegisteredExtractor,
  result: unknown,
  options: { readonly source?: IndexDiagnostic['source'] } = {},
): Exclude<StaticExtractionResult, { readonly kind: 'no-match' }> {
  const normalized = normalizeExtractResult(result)
  if (!normalized.ok) {
    return {
      kind: 'degraded',
      extension: extensionIdentity(item.extension),
      extractor: item.extractor.name,
      dependencies: runtimeDependencies(item, undefined),
      diagnostics: [extractorResultInvalidDiagnostic(item, options.source, normalized.reason)],
    }
  }

  const identity = extensionIdentity(item.extension)
  const dependencies = runtimeDependencies(item, normalized.result.dependencies)
  switch (normalized.result.kind) {
    case 'facts':
      return {
        kind: 'matched',
        extension: identity,
        extractor: item.extractor.name,
        facts: normalized.result.facts,
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
        ...(normalized.result.facts ? { facts: normalized.result.facts } : {}),
        dependencies,
        diagnostics: [...normalized.result.diagnostics],
      }
    default:
      return assertNever(normalized.result)
  }
}

/** Converts a thrown extractor failure into the normalized degraded result shape. */
export function runtimeResultFromExtractorError(
  item: RegisteredExtractor,
  source: IndexDiagnostic['source'] | undefined,
  error: unknown,
): Extract<StaticExtractionResult, { readonly kind: 'degraded' }> {
  return {
    kind: 'degraded',
    extension: extensionIdentity(item.extension),
    extractor: item.extractor.name,
    dependencies: runtimeDependencies(item, undefined),
    diagnostics: [extractorFailedDiagnostic(item, source, error)],
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

type NormalizeExtractResult =
  | { readonly ok: true; readonly result: ExtractResult }
  | { readonly ok: false; readonly reason: string }

function normalizeExtractResult(value: unknown): NormalizeExtractResult {
  if (!isRecord(value)) return { ok: false, reason: 'result must be an object' }
  switch (value.kind) {
    case 'none':
      return { ok: true, result: { kind: 'none', ...dependenciesProperty(value) } }
    case 'facts': {
      if (!isRecord(value.facts)) return { ok: false, reason: 'facts results must include a facts object' }
      return { ok: true, result: { kind: 'facts', facts: value.facts as ExtractedFacts, ...dependenciesProperty(value) } }
    }
    case 'degraded': {
      if (value.facts !== undefined && !isRecord(value.facts)) {
        return { ok: false, reason: 'degraded result facts must be an object when provided' }
      }
      if (!Array.isArray(value.diagnostics)) {
        return { ok: false, reason: 'degraded results must include a diagnostics array' }
      }
      return {
        ok: true,
        result: {
          kind: 'degraded',
          ...(value.facts ? { facts: value.facts as ExtractedFacts } : {}),
          diagnostics: value.diagnostics as readonly IndexDiagnostic[],
          ...dependenciesProperty(value),
        },
      }
    }
    default:
      return { ok: false, reason: 'result kind must be "facts", "none", or "degraded"' }
  }
}

function dependenciesProperty(value: Readonly<Record<string, unknown>>): { readonly dependencies?: readonly IndexDependency[] } {
  return Array.isArray(value.dependencies) ? { dependencies: value.dependencies as readonly IndexDependency[] } : {}
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}
