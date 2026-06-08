import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { IndexDependency } from './extensions'
import type { ProjectIndexCompilerProfile } from './compiler/profile'

/**
 * Cache epochs are intentional invalidation levers for compiler behavior that is not captured by
 * source/config hashes or structured dependency identities.
 */
export const STATIC_PARSE_CACHE_EPOCH = 'static-parse-v31'
export const SEMANTIC_FACTS_CACHE_EPOCH = 'semantic-facts-v6'
export const SEMANTIC_COMPILER_OPTIONS_ID = 'ts-bundler-es2022-strict-false'

export function cacheFileForIdentity(root: string, epoch: string, identity: unknown): string {
  return join(root, '.crux', 'cache', 'index', epoch, `${sha256(JSON.stringify(identity))}.json`)
}

export function compilerProfileCacheInputs(profile: ProjectIndexCompilerProfile): readonly IndexDependency[] {
  return [
    { kind: 'compiler-profile', name: profile.name, version: profile.version },
    ...(profile.intrinsics ?? []).map((intrinsic) => ({
      kind: 'compiler-intrinsic' as const,
      name: intrinsic.name,
      version: intrinsic.version,
      phase: intrinsic.phase,
    })),
  ]
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
