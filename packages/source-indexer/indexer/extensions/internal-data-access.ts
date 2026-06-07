import ts from 'typescript'
import type { ExtractContext } from './types'
import { resolvedSourceNodeForProperty } from '../ast/source-refs'
import {
  primitiveDataAccessRefs,
  primitiveDataAccessRefsWithHelpers,
  type PrimitiveDataAccessRef,
} from '../extractors/data-access'

/**
 * Private static parser payload required to inspect helper functions for data-access facts.
 *
 * This interface documents the minimum internal fields needed by the helper; it is not exported from
 * the public extension barrel.
 */
interface StaticNativeContext {
  readonly root: string
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly objectArg?: ts.ObjectLiteralExpression
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
}

/** Derives visible data-access facts from the current first-party extractor config object. */
export function internalDataAccessRefsForConfigObject(ctx: ExtractContext): readonly PrimitiveDataAccessRef[] {
  const staticCtx = staticContext(ctx)
  if (!staticCtx?.objectArg) return []
  return primitiveDataAccessRefs(staticCtx.objectArg, staticCtx.sourceFile)
}

/** Derives data-access facts from selected config properties, following helper functions when source refs allow it. */
export function internalDataAccessRefsForConfigProperties(
  ctx: ExtractContext,
  properties: readonly string[],
): readonly PrimitiveDataAccessRef[] {
  const staticCtx = staticContext(ctx)
  if (!staticCtx?.objectArg) return []
  const objectArg = staticCtx.objectArg
  return properties.flatMap((property) => {
    const resolved = resolvedSourceNodeForProperty({
      root: staticCtx.root,
      file: staticCtx.file,
      sourceFile: staticCtx.sourceFile,
      object: objectArg,
      property,
      localInitializers: staticCtx.localInitializers,
    })
    return resolved
      ? primitiveDataAccessRefsWithHelpers(resolved.node, resolved.sourceFile, {
          root: staticCtx.root,
          file: resolved.sourceFile.fileName,
          localInitializers: resolved.localInitializers,
        })
      : []
  })
}

/**
 * Reads the parser-owned static context used by internal data-access helpers.
 *
 * Returning `undefined` makes callers degrade to empty facts instead of throwing when a test or future
 * runtime profile does not provide the TypeScript-native escape hatch.
 */
function staticContext(ctx: ExtractContext): StaticNativeContext | undefined {
  const staticCtx = ctx.unstableNative?.staticContext
  return isStaticNativeContext(staticCtx) ? staticCtx : undefined
}

/** Narrows the unstable native payload to the static context shape required for data-access scanning. */
function isStaticNativeContext(value: unknown): value is StaticNativeContext {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'root' in value &&
      'file' in value &&
      'sourceFile' in value &&
      'localInitializers' in value,
  )
}
