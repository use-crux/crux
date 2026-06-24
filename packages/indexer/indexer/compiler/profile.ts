import type { IndexerExtension, IndexerExtensionRuntime, ResolvedIndexerExtension } from '../extensions'
import { createIndexerExtensionRuntime } from '../extensions'
import { cruxCoreExtension } from '../extractors/crux-core-extension'
export { compilerProfileCacheInputs } from '../cache-identity'

export interface CompilerOwnedProjection {
  readonly name: string
  readonly version: string
  readonly phase: 'parse' | 'extract' | 'resolve'
  readonly reason: string
  readonly staticCallNames?: readonly string[]
}

export interface ProjectIndexCompilerProfile {
  readonly name: string
  readonly version: string
  readonly extensions: readonly IndexerExtension[]
  readonly projections?: readonly CompilerOwnedProjection[]
}

export interface ProjectIndexCompilerRuntime {
  readonly profile: ProjectIndexCompilerProfile
  readonly extensionRuntime: IndexerExtensionRuntime
}

export const cruxCoreCompilerProjections = [
  {
    name: 'source-ref-projection',
    version: '1',
    phase: 'parse',
    reason: 'Parser-owned source-reference helpers project config properties, callbacks, templates, schemas, and helper usages.',
  },
  {
    name: 'runtime-prepare-use-entries',
    version: '1',
    phase: 'parse',
    reason: 'Runtime prepare helper usage is inferred from function bodies by compiler-owned traversal.',
  },
  {
    name: 'prompt-context-tree-paths',
    version: '1',
    phase: 'resolve',
    reason: 'createPrompts/createContexts path projection annotates known definitions after source-local extraction.',
  },
] as const satisfies readonly CompilerOwnedProjection[]

export const cruxCoreCompilerProfile = {
  name: '@crux/indexer/crux-core-profile',
  version: '1',
  extensions: [cruxCoreExtension],
  projections: cruxCoreCompilerProjections,
} as const satisfies ProjectIndexCompilerProfile

export function createProjectIndexCompilerRuntime(
  profile: ProjectIndexCompilerProfile = cruxCoreCompilerProfile,
): ProjectIndexCompilerRuntime {
  return {
    profile,
    extensionRuntime: createIndexerExtensionRuntime({ extensions: profile.extensions }),
  }
}

/**
 * Appends dynamically loaded extension manifests and their package identities to a compiler profile.
 *
 * Extension manifests expose their own behavior version, while the installed package version captures
 * the concrete code artifact selected by user config. Both must participate in cache identity so a
 * warm static cache cannot hide a package upgrade that leaves the manifest version unchanged.
 */
export function compilerProfileWithResolvedExtensions(
  profile: ProjectIndexCompilerProfile,
  extensions: readonly ResolvedIndexerExtension[],
): ProjectIndexCompilerProfile {
  if (extensions.length === 0) return profile
  return {
    ...profile,
    extensions: [...profile.extensions, ...extensions.map((entry) => entry.extension)],
    projections: [
      ...(profile.projections ?? []),
      ...extensions.map((entry) => ({
        name: `indexer-extension-package:${entry.reference.package}#${entry.reference.export ?? 'default'}`,
        version: entry.packageVersion ?? entry.extension.version,
        phase: 'parse' as const,
        reason: 'Configured Indexer extension package identity participates in static cache invalidation.',
      })),
    ],
  }
}

export function compilerProjectionStaticCallNames(profile: ProjectIndexCompilerProfile): readonly string[] {
  return [...new Set((profile.projections ?? []).flatMap((projection) => projection.staticCallNames ?? []))].sort()
}
