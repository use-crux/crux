import { resolve } from 'node:path'
import ts from 'typescript'
import { SEMANTIC_COMPILER_OPTIONS_ID } from '../../cache-identity'
import { discoverProjectShards } from '../../shards/discovery'
import type { SemanticBackendIdentity, SemanticProjectSessionIdentity } from './types'

/**
 * Options for constructing a semantic project session identity.
 */
export interface SemanticProjectSessionIdentityOptions {
  /** Backend that will own the session. */
  readonly backend: SemanticBackendIdentity
  /** TypeScript version to record. Defaults to the installed compiler API. */
  readonly typescriptVersion?: string
  /** Compiler option identity to record. Defaults to Crux's semantic profile. */
  readonly compilerOptionsId?: string
}

/**
 * Builds the reusable semantic project/session identity for a root.
 *
 * The identity is deliberately made from stable strings only. Backends can use
 * it to decide whether cached project state is reusable without leaking
 * compiler objects across the worker or package boundary.
 */
export function semanticProjectSessionIdentity(
  root: string,
  options: SemanticProjectSessionIdentityOptions,
): SemanticProjectSessionIdentity {
  return {
    root: resolve(root),
    tsconfigFiles: discoveredTsconfigFiles(root),
    typescriptVersion: options.typescriptVersion ?? ts.version,
    compilerOptionsId: options.compilerOptionsId ?? SEMANTIC_COMPILER_OPTIONS_ID,
    backend: options.backend,
  }
}

function discoveredTsconfigFiles(root: string): readonly string[] {
  return [
    ...new Set(
      discoverProjectShards(root)
        .shards.map((shard) => shard.configFile)
        .filter((file): file is string => typeof file === 'string' && file.length > 0),
    ),
  ].sort()
}
