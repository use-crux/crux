import ts from 'typescript'
import { identifierArrayProperty, identifierProperty, propertyName, stringProperty, toolNamesProperty } from '../ast/literals'
import { callbackSourceRefForProperty, helperSourceRefsForNode, resolvedSourceNodeForProperty } from '../ast/source-refs'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'
import { primitiveDataAccessRefs, primitiveDataAccessRefsWithHelpers, primitiveDataIntelligence, type PrimitiveDataAccessRef } from './data-access'
import type { StaticRelationRef } from '../types'

export const agentExtractor: PrimitiveExtractor = {
  name: 'agent',
  capabilities: ['definition', 'relation', 'source', 'runtime-join', 'partial'],
  callNames: ['agent'],
  extract: (ctx) => {
    if (ctx.callName !== 'agent' || !ctx.objectArg) return undefined
    const explicitId = stringProperty(ctx.objectArg, 'id')
    const id = `agent:${ctx.safeId(explicitId ?? ctx.localName)}`
    const relationRefs: StaticRelationRef[] = []
    const promptRef = identifierProperty(ctx.objectArg, 'prompt')
    if (promptRef) relationRefs.push({ type: 'agent.uses_prompt', toVariable: promptRef })
    const toolRefs = identifierArrayProperty(ctx.objectArg, 'tools')
    for (const toolRef of toolRefs) {
      relationRefs.push({ type: 'agent.uses_tool', toVariable: toolRef })
    }
    const handoffs = handoffIdsProperty(ctx.objectArg, 'handoffs')
    for (const handoffId of handoffs) {
      relationRefs.push({ type: 'agent.can_handoff_to', toId: `agent:${ctx.safeId(handoffId)}` })
    }
    const callbackProperties = ['handler', 'run', 'execute', 'contextHandler', 'usageHandler']
    const resolvedCallbacks = callbackProperties
      .map((property) => ({ property, resolved: resolvedSourceNodeForProperty({ ...ctx, object: ctx.objectArg!, property }) }))
      .filter((item): item is { property: string; resolved: NonNullable<typeof item.resolved> } => Boolean(item.resolved))
    const callbackRefs = callbackProperties
      .map((property) =>
        callbackSourceRefForProperty({
          ...ctx,
          object: ctx.objectArg!,
          property,
          role: property === 'handler' ? 'handler' : property === 'execute' ? 'execute' : 'callback',
          definitionId: id,
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
    const callbackDataAccesses = resolvedCallbacks.flatMap((item) =>
      primitiveDataAccessRefsWithHelpers(item.resolved.node, item.resolved.sourceFile, {
        root: ctx.root,
        file: item.resolved.sourceFile.fileName,
        localInitializers: item.resolved.localInitializers,
      }),
    )
    const sourceRefs = [...callbackRefs, ...helperRefs]
    const dataAccesses = [...primitiveDataAccessRefs(ctx.objectArg, ctx.sourceFile), ...callbackDataAccesses]
    relationRefs.push(...dataAccessRelationRefs(id, dataAccesses))
    return foundDefinition(
      ctx.variableName,
      {
        ...ctx.define(id, 'agent', explicitId ?? ctx.variableName, ctx.objectArg, {
          exportName: ctx.variableName,
          toolNames: toolNamesProperty(ctx.objectArg, 'tools'),
          handoffs,
          intelligence: agentIntelligence(promptRef, toolRefs, handoffs, dataAccesses),
        }),
        ...(sourceRefs.length > 0 ? { sourceRefs } : {}),
      },
      relationRefs,
    )
  },
}

function agentIntelligence(
  promptRef: string | undefined,
  toolRefs: readonly string[],
  handoffs: readonly string[],
  dataAccesses: readonly PrimitiveDataAccessRef[],
): Record<string, unknown> | undefined {
  const data = primitiveDataIntelligence(dataAccesses)?.data
  if (!promptRef && toolRefs.length === 0 && handoffs.length === 0 && !data) return undefined
  return {
    confidence: 'static',
    control: {
      mode: handoffs.length > 0 ? 'event-driven' : 'immediate',
      ordering: 'event-driven',
    },
    dependencies: {
      ...(promptRef ? { prompt: promptRef } : {}),
      ...(toolRefs.length > 0 ? { tools: [...toolRefs] } : {}),
      ...(handoffs.length > 0 ? { handoffs: [...handoffs] } : {}),
    },
    ...(data ? { data } : {}),
  }
}

function dataAccessRelationRefs(fromId: string, accesses: readonly PrimitiveDataAccessRef[]): StaticRelationRef[] {
  return accesses.map((access) => ({
    type: access.kind === 'read' ? 'agent.reads_memory' : 'agent.writes_memory',
    typeByTargetKind:
      access.kind === 'read'
        ? {
            memory: 'agent.reads_memory',
            blackboard: 'agent.reads_blackboard',
            workspace: 'agent.reads_workspace',
          }
        : {
            memory: 'agent.writes_memory',
            blackboard: 'agent.writes_blackboard',
            workspace: 'agent.writes_workspace',
          },
    fromId,
    toVariable: access.targetVariable,
  }))
}

function handoffIdsProperty(object: ts.ObjectLiteralExpression, name: string): string[] {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  if (!property || !ts.isArrayLiteralExpression(property.initializer)) return []
  return property.initializer.elements
    .map((element) => {
      if (ts.isStringLiteralLike(element)) return element.text
      if (ts.isObjectLiteralExpression(element)) return stringProperty(element, 'id')
      return undefined
    })
    .filter((value): value is string => typeof value === 'string')
}
