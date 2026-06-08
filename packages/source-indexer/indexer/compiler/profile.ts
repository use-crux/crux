import type { SourceIndexerExtension, SourceIndexerExtensionRuntime } from '../extensions'
import { createSourceIndexerExtensionRuntime } from '../extensions'
import { cruxCoreExtension } from '../extractors/crux-core-extension'

export interface CompilerIntrinsic {
  readonly name: string
  readonly version: string
  readonly phase: 'parse' | 'extract' | 'resolve'
  readonly reason: string
  readonly staticCallNames?: readonly string[]
}

export interface ProjectCatalogCompilerProfile {
  readonly name: string
  readonly version: string
  readonly extensions: readonly SourceIndexerExtension[]
  readonly intrinsics?: readonly CompilerIntrinsic[]
}

export interface ProjectCatalogCompilerRuntime {
  readonly profile: ProjectCatalogCompilerProfile
  readonly extensionRuntime: SourceIndexerExtensionRuntime
}

export const cruxCoreCompilerIntrinsics = [
  {
    name: 'convexAgent-call',
    version: '1',
    phase: 'extract',
    reason: 'Convex agent declarations still require compiler-owned projection before they can be normal extractors.',
    staticCallNames: ['convexAgent'],
  },
  {
    name: 'agent-constructor',
    version: '1',
    phase: 'extract',
    reason: 'Constructor call-site discovery is a first-party compatibility path for authored Agent instances.',
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
] as const satisfies readonly CompilerIntrinsic[]

export const cruxCoreCompilerProfile = {
  name: '@crux/source-indexer/crux-core-profile',
  version: '1',
  extensions: [cruxCoreExtension],
  intrinsics: cruxCoreCompilerIntrinsics,
} as const satisfies ProjectCatalogCompilerProfile

export function createProjectCatalogCompilerRuntime(
  profile: ProjectCatalogCompilerProfile = cruxCoreCompilerProfile,
): ProjectCatalogCompilerRuntime {
  return {
    profile,
    extensionRuntime: createSourceIndexerExtensionRuntime({ extensions: profile.extensions }),
  }
}

export function compilerIntrinsicStaticCallNames(profile: ProjectCatalogCompilerProfile): readonly string[] {
  return [...new Set((profile.intrinsics ?? []).flatMap((intrinsic) => intrinsic.staticCallNames ?? []))].sort()
}
