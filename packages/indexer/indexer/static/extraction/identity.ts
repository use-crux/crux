import ts from 'typescript'
import type { IndexDependency, IndexerExtensionRuntime } from '../../extensions'
import { compilerProfileCacheInputs, type ProjectIndexCompilerProfile } from '../../compiler/profile'

/**
 * Structural identity for one static extraction engine.
 *
 * Cache identity is not a version string. It is a projection of every compiler input that can change
 * static output without changing the source file itself: extension manifests, extractor identities,
 * rule identities, compiler profile/projection identities, and the syntax frontend version.
 */
export interface StaticExtractionIdentity {
  /** Stable, JSON-serializable dependencies that participate in static cache keys. */
  readonly cacheInputs: readonly IndexDependency[]
  /** Source-local call names the parser should consider during call-site discovery. */
  readonly callNames: ReadonlySet<string>
}

/**
 * Computes deterministic cache and parser identity from a compiler profile plus extension runtime.
 */
export function staticExtractionIdentity(input: {
  readonly profile: ProjectIndexCompilerProfile
  readonly extensionRuntime: IndexerExtensionRuntime
}): StaticExtractionIdentity {
  const cacheInputs = stableDependencies([
    ...input.extensionRuntime.manifest.cacheInputs,
    ...compilerProfileCacheInputs(input.profile),
    syntaxFrontendIdentity(),
  ])
  const callNames = new Set([
    ...input.extensionRuntime.manifest.callNames,
    ...(input.profile.projections ?? []).flatMap((projection) => projection.staticCallNames ?? []),
  ])
  return Object.freeze({
    cacheInputs,
    callNames,
  })
}

/**
 * Captures the TypeScript parser version as an explicit cache dependency.
 *
 * Static extraction relies on TypeScript's AST shape and source-position behavior. A TypeScript
 * upgrade can therefore change extracted facts even when project source and extension code are
 * unchanged.
 */
function syntaxFrontendIdentity(): IndexDependency {
  return {
    kind: 'syntax-frontend',
    name: 'typescript',
    version: ts.version,
  }
}

/**
 * Canonicalizes dependency order.
 *
 * Two engines with the same semantic configuration should produce byte-identical cache inputs even
 * when manifests were authored in a different order.
 */
function stableDependencies(dependencies: readonly IndexDependency[]): readonly IndexDependency[] {
  const byKey = new Map<string, IndexDependency>()
  for (const dependency of dependencies) {
    byKey.set(JSON.stringify(dependency), dependency)
  }
  return Object.freeze(
    [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value),
  )
}
