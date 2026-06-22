import ts from 'typescript'
import type { ExtractContext } from './types'
import { internalStaticCallContext, internalStaticRecordContext } from './internal-native'
import { resolvedSourceNodeForProperty } from '../ast/source-refs'
import { staticObjectPropertyValue } from '../static/syntax-record/value'
import {
  primitiveDataAccessRefs,
  primitiveDataAccessRefsWithHelpers,
  type PrimitiveDataAccessRef,
} from '../extractors/data-access'
import { staticRecordDataAccessRefsFromValue } from './static-record-data-access'

/**
 * Private static parser payload required to inspect helper functions for data-access facts.
 *
 * This interface documents the minimum internal fields needed by the helper; it is not exported from
 * the public extension barrel.
 */
/** Derives visible data-access facts from the current first-party extractor config object. */
export function internalDataAccessRefsForConfigObject(ctx: ExtractContext): readonly PrimitiveDataAccessRef[] {
  const staticCtx = internalStaticCallContext(ctx)
  if (!staticCtx?.objectArg) {
    const recordCtx = internalStaticRecordContext(ctx)
    return recordCtx?.objectArg
      ? staticRecordDataAccessRefsFromValue(recordCtx.objectArg, recordCtx.initializers)
      : []
  }
  return primitiveDataAccessRefs(staticCtx.objectArg, staticCtx.sourceFile)
}

/** Derives data-access facts from selected config properties, following helper functions when source refs allow it. */
export function internalDataAccessRefsForConfigProperties(
  ctx: ExtractContext,
  properties: readonly string[],
): readonly PrimitiveDataAccessRef[] {
  const staticCtx = internalStaticCallContext(ctx)
  if (!staticCtx?.objectArg) {
    const recordCtx = internalStaticRecordContext(ctx)
    if (!recordCtx?.objectArg) return []
    const objectArg = recordCtx.objectArg
    return properties.flatMap((property) =>
      staticRecordDataAccessRefsFromValue(
        staticObjectPropertyValue(objectArg, property),
        recordCtx.initializers,
      ),
    )
  }
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
