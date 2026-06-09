import ts from 'typescript'
import type { IndexDependency, IndexerExtensionRuntime } from '../../extensions'
import { compilerProfileCacheInputs, type ProjectIndexCompilerProfile } from '../../compiler/profile'

export interface StaticExtractionIdentity {
  readonly cacheInputs: readonly IndexDependency[]
  readonly callNames: ReadonlySet<string>
}

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

function syntaxFrontendIdentity(): IndexDependency {
  return {
    kind: 'syntax-frontend',
    name: 'typescript',
    version: ts.version,
  }
}

function stableDependencies(dependencies: readonly IndexDependency[]): readonly IndexDependency[] {
  const byKey = new Map<string, IndexDependency>()
  for (const dependency of dependencies) {
    byKey.set(JSON.stringify(dependency), dependency)
  }
  return Object.freeze(
    [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value),
  )
}
