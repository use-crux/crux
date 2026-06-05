import { hasProperty, stringProperty } from '../ast/literals'
import { callbackSourceRefForProperty, helperSourceRefsForNode, resolvedSourceNodeForProperty, schemaPropertyWithSourceRef } from '../ast/source-refs'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'
import { primitiveDataAccessRefs, primitiveDataAccessRefsWithHelpers, primitiveDataIntelligence, type PrimitiveDataAccessRef } from './data-access'
import type { StaticRelationRef } from '../types'

export const toolExtractor: PrimitiveExtractor = {
  name: 'tool',
  capabilities: ['definition', 'schema', 'source', 'runtime-join', 'partial'],
  callNames: ['createTool', 'tool'],
  extract: (ctx) => {
    if ((ctx.callName !== 'createTool' && ctx.callName !== 'tool') || !ctx.objectArg) return undefined
    const explicitName = stringProperty(ctx.objectArg, 'name') ?? stringProperty(ctx.objectArg, 'title')
    const id = `tool:${ctx.safeId(explicitName ?? ctx.variableName)}`
    const callbackProperties = ['execute', 'run', 'handler']
    const resolvedCallbacks = callbackProperties
      .map((property) => ({ property, resolved: resolvedSourceNodeForProperty({ ...ctx, object: ctx.objectArg!, property }) }))
      .filter((item): item is { property: string; resolved: NonNullable<typeof item.resolved> } => Boolean(item.resolved))
    const callbackDataAccesses = resolvedCallbacks.flatMap((item) =>
      primitiveDataAccessRefsWithHelpers(item.resolved.node, item.resolved.sourceFile, {
        root: ctx.root,
        file: item.resolved.sourceFile.fileName,
        localInitializers: item.resolved.localInitializers,
      }),
    )
    const dataAccesses = [...primitiveDataAccessRefs(ctx.objectArg, ctx.sourceFile), ...callbackDataAccesses]
    const schema = schemaPropertyWithSourceRef({
      root: ctx.root,
      file: ctx.file,
      sourceFile: ctx.sourceFile,
      object: ctx.objectArg,
      property: 'parameters',
      definitionId: id,
      localInitializers: ctx.localInitializers,
    })
    const callbackRefs = callbackProperties
      .map((property) =>
        callbackSourceRefForProperty({
          root: ctx.root,
          file: ctx.file,
          sourceFile: ctx.sourceFile,
          object: ctx.objectArg!,
          property,
          role: property === 'execute' ? 'execute' : property === 'handler' ? 'handler' : 'callback',
          definitionId: id,
          localInitializers: ctx.localInitializers,
        }),
      )
      .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
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
    const sourceRefs = [...schema.sourceRefs, ...callbackRefs, ...helperRefs]
    const dataIntelligence = primitiveDataIntelligence(dataAccesses)
    return foundDefinition(
      ctx.variableName,
      {
        ...ctx.define(id, 'tool', explicitName ?? ctx.variableName, ctx.objectArg, {
          exportName: ctx.variableName,
          inputSchema: schema.schema,
          hasExecute: hasProperty(ctx.objectArg, 'execute') || hasProperty(ctx.objectArg, 'run') || hasProperty(ctx.objectArg, 'handler'),
          hasToModelOutput: hasProperty(ctx.objectArg, 'toModelOutput'),
          facts: {
            kind: 'tool',
            toolName: explicitName ?? ctx.variableName,
            hasExecute: hasProperty(ctx.objectArg, 'execute') || hasProperty(ctx.objectArg, 'run') || hasProperty(ctx.objectArg, 'handler'),
            hasToModelOutput: hasProperty(ctx.objectArg, 'toModelOutput'),
          },
          intelligence: {
            confidence: 'static',
            ...(schema.schema ? { contract: { inputSchema: schema.schema } } : {}),
            ...(dataIntelligence?.data ? { data: dataIntelligence.data } : {}),
          },
        }),
        ...(sourceRefs.length > 0 ? { sourceRefs } : {}),
      },
      dataAccessRelationRefs(id, dataAccesses),
    )
  },
}

function dataAccessRelationRefs(fromId: string, accesses: readonly PrimitiveDataAccessRef[]): StaticRelationRef[] {
  return accesses.map((access) => ({
    type: access.kind === 'read' ? 'tool.reads_memory' : 'tool.writes_memory',
    typeByTargetKind:
      access.kind === 'read'
        ? {
            memory: 'tool.reads_memory',
            blackboard: 'tool.reads_blackboard',
            workspace: 'tool.reads_workspace',
          }
        : {
            memory: 'tool.writes_memory',
            blackboard: 'tool.writes_blackboard',
            workspace: 'tool.writes_workspace',
          },
    fromId,
    toVariable: access.targetVariable,
  }))
}
