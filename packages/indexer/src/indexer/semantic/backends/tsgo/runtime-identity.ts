import type { SemanticCompilerRuntimeIdentity } from '../../service/types'
import { resolveTsgoExecutablePath } from './executable'
import type { NativeSemanticEngineName } from './types'

/** Protocol/package version recorded for TypeScript-Go semantic runtime identity. */
export const tsgoNativeSemanticRuntimeVersion = 'native-preview-v1'

export interface NativeSemanticCompilerRuntimeIdentityOptions {
  /** Absolute Project Index root used to resolve workspace-local native-preview packages. */
  readonly root: string
  /** Native engine implementation. Defaults to `tsgo`. */
  readonly engine?: NativeSemanticEngineName
  /** Explicit TypeScript-Go executable path from config or environment. */
  readonly tsserverPath?: string
}

/**
 * Returns the compiler runtime identity used by the experimental native backend.
 *
 * The native backend identity describes Crux's adapter. This identity describes
 * the TypeScript-Go runtime that owns semantic project state and therefore must
 * participate in session and cache keys.
 */
export function nativeSemanticCompilerRuntimeIdentity(
  options: NativeSemanticCompilerRuntimeIdentityOptions,
): SemanticCompilerRuntimeIdentity<'tsgo'> {
  switch (options.engine ?? 'tsgo') {
    case 'tsgo':
      return tsgoSemanticCompilerRuntimeIdentity(options)
  }
}

/** Returns the TypeScript-Go runtime identity for one project root. */
export function tsgoSemanticCompilerRuntimeIdentity(
  options: Omit<NativeSemanticCompilerRuntimeIdentityOptions, 'engine'>,
): SemanticCompilerRuntimeIdentity<'tsgo'> {
  return {
    name: 'tsgo',
    version: tsgoNativeSemanticRuntimeVersion,
    executable: resolveTsgoExecutablePath({ root: options.root, explicitPath: options.tsserverPath }),
  }
}
