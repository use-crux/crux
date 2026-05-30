import { hasProperty, stringProperty } from '../ast/literals'
import { callbackSourceRefForProperty, helperSourceRefsForNode, resolvedSourceNodeForProperty, schemaPropertyWithSourceRef, sourceRefForProperty, sourceRefsForTemplateInterpolations } from '../ast/source-refs'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'
import { primitiveDataAccessRefsWithHelpers, primitiveDataIntelligence, type PrimitiveDataAccessRef } from './data-access'

export const contextExtractor: PrimitiveExtractor = {
  name: 'context',
  capabilities: ['definition', 'schema', 'source', 'runtime-join', 'partial'],
  callNames: ['context'],
  extract: (ctx) => {
    if (ctx.callName !== 'context' || !ctx.objectArg) return undefined
    const explicitId = stringProperty(ctx.objectArg, 'id')
    const id = `context:${ctx.safeId(explicitId ?? ctx.localName)}`
    const inputSchema = schemaPropertyWithSourceRef({
      root: ctx.root,
      file: ctx.file,
      sourceFile: ctx.sourceFile,
      object: ctx.objectArg,
      property: 'input',
      definitionId: id,
      localInitializers: ctx.localInitializers,
    })
    const callbackProperties = ['resolve', 'render', 'handler', 'when', 'system']
    const resolvedCallbacks = callbackProperties
      .map((property) => ({ property, resolved: resolvedSourceNodeForProperty({ ...ctx, object: ctx.objectArg!, property }) }))
      .filter((item): item is { property: string; resolved: NonNullable<typeof item.resolved> } => Boolean(item.resolved))
    const callbackRefs = [
      callbackSourceRefForProperty({ ...ctx, object: ctx.objectArg, property: 'resolve', role: 'resolver', definitionId: id }),
      callbackSourceRefForProperty({ ...ctx, object: ctx.objectArg, property: 'render', role: 'callback', definitionId: id }),
      callbackSourceRefForProperty({ ...ctx, object: ctx.objectArg, property: 'handler', role: 'handler', definitionId: id }),
      callbackSourceRefForProperty({ ...ctx, object: ctx.objectArg, property: 'when', role: 'policy', definitionId: id }),
      sourceRefForProperty({ ...ctx, object: ctx.objectArg, property: 'system', role: 'system', definitionId: id, metadata: { fragment: true } }) ??
        callbackSourceRefForProperty({ ...ctx, object: ctx.objectArg, property: 'system', role: 'system', definitionId: id }),
    ].filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
    const interpolationRefs = sourceRefsForTemplateInterpolations({
      ...ctx,
      object: ctx.objectArg,
      property: 'system',
      role: 'system',
      definitionId: id,
    })
    const helperRefs = resolvedCallbacks.flatMap((item) =>
      helperSourceRefsForNode({
        definitionId: id,
        root: ctx.root,
        file: item.resolved.sourceFile.fileName,
        sourceFile: item.resolved.sourceFile,
        node: item.resolved.node,
        localInitializers: item.resolved.localInitializers,
      }),
    )
    const dataAccesses = resolvedCallbacks.flatMap((item) =>
      primitiveDataAccessRefsWithHelpers(item.resolved.node, item.resolved.sourceFile, {
        root: ctx.root,
        file: item.resolved.sourceFile.fileName,
        localInitializers: item.resolved.localInitializers,
      }),
    )
    const sourceRefs = [...inputSchema.sourceRefs, ...callbackRefs, ...interpolationRefs, ...helperRefs]
    return foundDefinition(
      ctx.variableName,
      {
        ...ctx.define(id, 'context', explicitId ?? ctx.variableName, ctx.objectArg, {
          exportName: ctx.variableName,
          inputSchema: inputSchema.schema,
          isStatic: !hasProperty(ctx.objectArg, 'input'),
          intelligence: primitiveDataIntelligence(dataAccesses),
        }),
        ...(sourceRefs.length > 0 ? { sourceRefs } : {}),
      },
      dataAccessRelationRefs(id, dataAccesses),
    )
  },
}

function dataAccessRelationRefs(fromId: string, accesses: readonly PrimitiveDataAccessRef[]) {
  return accesses.map((access) => ({
    type: access.kind === 'read' ? 'context.reads_memory' : 'context.writes_memory',
    typeByTargetKind:
      access.kind === 'read'
        ? {
            memory: 'context.reads_memory',
            blackboard: 'context.reads_blackboard',
            workspace: 'context.reads_workspace',
          }
        : {
            memory: 'context.writes_memory',
            blackboard: 'context.writes_blackboard',
            workspace: 'context.writes_workspace',
          },
    fromId,
    toVariable: access.targetVariable,
  }))
}
