import ts from 'typescript'
import type { ProjectDefinition, ProjectDefinitionKind } from '@crux/core/catalog'
import { identifierArrayProperty, identifierProperty, propertyName, stringProperty } from '../ast/literals'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'

export const compositionExtractor: PrimitiveExtractor = {
  name: 'composition',
  capabilities: ['definition', 'relation', 'source', 'runtime-join', 'partial'],
  callNames: ['parallel', 'pipeline', 'consensus', 'swarm'],
  extract: (ctx) => {
    const compositionKind = compositionKindForCall(ctx.callName)
    if (!compositionKind) return undefined
    const id = `${compositionKind}:${ctx.safeId(ctx.variableName)}`
    const childDefinitions = compositionChildDefinitions(ctx.callName, ctx, id)
    const childRelations = compositionChildRelationRefs(ctx.callName, childDefinitions)
    return foundDefinition(
      ctx.variableName,
      ctx.define(id, compositionKind, ctx.variableName, undefined, {
        exportName: ctx.variableName,
        ...compositionMetadata(ctx.callName, ctx.objectArg),
        intelligence: compositionIntelligence(ctx.callName, childDefinitions),
      }),
      [
        ...compositionAgentRefs(ctx.callName, ctx.objectArg).map((toVariable) => ({
          type: 'composition.uses_agent',
          typeByTargetKind: {
            agent: 'composition.uses_agent',
            flow: 'composition.uses_flow',
            prompt: 'composition.uses_prompt',
            tool: 'composition.uses_tool',
          },
          toVariable,
        })),
        ...compositionStructuralRelationRefs(ctx.callName, ctx.objectArg, id, ctx.safeId),
        ...childRelations,
      ],
      childDefinitions.map((child) => child.definition),
    )
  },
}

function compositionMetadata(callName: string, objectArg: ts.ObjectLiteralExpression | undefined): Record<string, unknown> {
  if (!objectArg) return {}
  if (callName === 'consensus') {
    const participants = identifierArrayProperty(objectArg, 'agents')
    const judge = identifierProperty(objectArg, 'judge')
    const scorer = identifierProperty(objectArg, 'scorer')
    return {
      ...(participants.length > 0 ? { participants } : {}),
      ...(judge ? { judge } : {}),
      ...(scorer ? { scorer } : {}),
    }
  }
  if (callName === 'swarm') {
    const participants = identifierObjectValuesProperty(objectArg, 'agents')
    const coordinator = stringProperty(objectArg, 'startAgent')
    const blackboard = identifierProperty(objectArg, 'blackboard')
    const memories = identifierArrayProperty(objectArg, 'memory')
    const singleMemory = identifierProperty(objectArg, 'memory')
    return {
      ...(coordinator ? { coordinator } : {}),
      ...(participants.length > 0 ? { participants } : {}),
      ...(blackboard ? { sharedBlackboard: blackboard } : {}),
      ...(singleMemory ? { sharedMemory: singleMemory } : {}),
      ...(memories.length > 0 ? { sharedMemory: memories } : {}),
    }
  }
  return {}
}

function compositionStructuralRelationRefs(
  callName: string,
  objectArg: ts.ObjectLiteralExpression | undefined,
  compositionId: string,
  safeId: (value: string) => string,
) {
  if (!objectArg) return []
  if (callName === 'consensus') {
    const agents = identifierArrayProperty(objectArg, 'agents').map((toVariable) => ({
      type: 'consensus.includes_agent',
      fromId: compositionId,
      toVariable,
    }))
    const judge = identifierProperty(objectArg, 'judge')
    const scorer = identifierProperty(objectArg, 'scorer')
    return [
      ...agents,
      ...(judge
        ? [{
            type: 'consensus.uses_judge',
            typeByTargetKind: {
              agent: 'consensus.uses_judge',
              scorer: 'consensus.uses_scorer',
            },
            fromId: compositionId,
            toVariable: judge,
          }]
        : []),
      ...(scorer ? [{ type: 'consensus.uses_scorer', fromId: compositionId, toVariable: scorer }] : []),
    ]
  }
  if (callName === 'swarm') {
    const agents = identifierObjectValuesProperty(objectArg, 'agents').map((toVariable) => ({
      type: 'swarm.includes_agent',
      fromId: compositionId,
      toVariable,
    }))
    const coordinator = stringProperty(objectArg, 'startAgent')
    const blackboard = identifierProperty(objectArg, 'blackboard')
    const memories = identifierArrayProperty(objectArg, 'memory')
    const singleMemory = identifierProperty(objectArg, 'memory')
    return [
      ...agents,
      ...(coordinator
        ? [{
            type: 'swarm.coordinated_by',
            fromId: compositionId,
            toId: `agent:${safeId(coordinator)}`,
          }]
        : []),
      ...(blackboard ? [{ type: 'swarm.uses_blackboard', fromId: compositionId, toVariable: blackboard }] : []),
      ...(singleMemory ? [{ type: 'swarm.uses_memory', fromId: compositionId, toVariable: singleMemory }] : []),
      ...memories.map((toVariable) => ({ type: 'swarm.uses_memory', fromId: compositionId, toVariable })),
    ]
  }
  return []
}

interface CompositionChild {
  readonly definition: ProjectDefinition
  readonly targetVariable?: string
  readonly targetProperty?: 'agent' | 'flow' | 'prompt' | 'tool'
}

function compositionChildDefinitions(callName: string, ctx: Parameters<PrimitiveExtractor['extract']>[0], compositionId: string): CompositionChild[] {
  if (!ctx.objectArg) return []
  if (callName === 'parallel') return parallelBranchDefinitions(ctx, compositionId)
  if (callName === 'pipeline') return pipelineStageDefinitions(ctx, compositionId)
  return []
}

function propertyObject(object: ts.ObjectLiteralExpression | undefined, name: string): ts.ObjectLiteralExpression | undefined {
  if (!object) return undefined
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  return property && ts.isObjectLiteralExpression(property.initializer) ? property.initializer : undefined
}

function propertyArray(object: ts.ObjectLiteralExpression | undefined, name: string): ts.ArrayLiteralExpression | undefined {
  if (!object) return undefined
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  return property && ts.isArrayLiteralExpression(property.initializer) ? property.initializer : undefined
}

function parallelBranchDefinitions(ctx: Parameters<PrimitiveExtractor['extract']>[0], compositionId: string): CompositionChild[] {
  const agents = propertyObject(ctx.objectArg, 'agents')
  if (!agents) return []
  return agents.properties.flatMap((item) => {
    const branchId = (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) ? propertyName(item.name) : undefined
    if (!branchId) return []
    const targetVariable = ts.isShorthandPropertyAssignment(item)
      ? item.name.text
      : ts.isPropertyAssignment(item) && ts.isIdentifier(item.initializer)
        ? item.initializer.text
        : undefined
    return [{
      definition: ctx.define(`${compositionId}:branch:${ctx.safeId(branchId)}`, 'composition.parallel.branch', branchId, undefined, {
        compositionId,
        branchId,
        ...(targetVariable ? { targetVariable } : {}),
        ...(targetVariable ? { targetProperty: 'agent' } : {}),
        intelligence: {
          confidence: 'static',
          control: { mode: 'parallel', ordering: 'concurrent' },
        },
      }),
      targetVariable,
      targetProperty: targetVariable ? 'agent' : undefined,
    }]
  })
}

function pipelineStageDefinitions(ctx: Parameters<PrimitiveExtractor['extract']>[0], compositionId: string): CompositionChild[] {
  const steps = propertyArray(ctx.objectArg, 'steps')
  if (!steps) return []
  return steps.elements.flatMap((element, index) => {
    if (!ts.isObjectLiteralExpression(element)) return []
    const stageId = stringProperty(element, 'name') ?? `stage-${index + 1}`
    const target = pipelineStageTarget(element)
    return [{
      definition: ctx.define(`${compositionId}:stage:${ctx.safeId(stageId)}`, 'composition.pipeline.stage', stageId, element, {
        compositionId,
        stageId,
        index,
        ...(target.variable ? { targetVariable: target.variable } : {}),
        ...(target.property ? { targetProperty: target.property } : {}),
        intelligence: {
          confidence: 'static',
          control: { mode: 'sequential', ordering: 'ordered' },
        },
      }),
      targetVariable: target.variable,
      targetProperty: target.property,
    }]
  })
}

function pipelineStageTarget(object: ts.ObjectLiteralExpression): { variable?: string; property?: 'agent' | 'flow' | 'prompt' | 'tool' } {
  for (const property of ['agent', 'flow', 'prompt', 'tool'] as const) {
    const variable = identifierProperty(object, property)
    if (variable) return { variable, property }
  }
  return {}
}

function compositionChildRelationRefs(callName: string, children: readonly CompositionChild[]) {
  return children.flatMap((child) => {
    const compositionId = String(child.definition.metadata?.compositionId ?? '')
    const includesType = callName === 'parallel' ? 'parallel.includes_branch' : callName === 'pipeline' ? 'pipeline.includes_stage' : undefined
    const usesType = callName === 'parallel' ? 'parallel.branch.uses_agent' : callName === 'pipeline' ? 'pipeline.stage.uses_agent' : undefined
    if (!compositionId || !includesType || !usesType) return []
    return [
      { type: includesType, fromId: compositionId, toId: child.definition.id },
      ...(child.targetVariable
        ? [{
            type: usesType,
            typeByTargetKind: {
              agent: usesType,
              flow: callName === 'parallel' ? 'parallel.branch.uses_flow' : 'pipeline.stage.uses_flow',
              prompt: callName === 'parallel' ? 'parallel.branch.uses_prompt' : 'pipeline.stage.uses_prompt',
              tool: callName === 'parallel' ? 'parallel.branch.uses_tool' : 'pipeline.stage.uses_tool',
            },
            fromId: child.definition.id,
            toVariable: child.targetVariable,
          }]
        : []),
    ]
  })
}

function compositionIntelligence(callName: string, children: readonly CompositionChild[]): Record<string, unknown> {
  const modeByCall: Record<string, string> = {
    parallel: 'parallel',
    pipeline: 'sequential',
    consensus: 'consensus',
    swarm: 'swarm',
  }
  const orderingByCall: Record<string, string> = {
    parallel: 'concurrent',
    pipeline: 'ordered',
    consensus: 'concurrent',
    swarm: 'event-driven',
  }
  return {
    confidence: 'static',
    control: {
      mode: modeByCall[callName] ?? 'immediate',
      ordering: orderingByCall[callName] ?? 'unknown',
    },
    ...(children.length > 0 ? { children: children.map((child) => child.definition.id) } : {}),
  }
}

function compositionKindForCall(callName: string): ProjectDefinitionKind | undefined {
  switch (callName) {
    case 'parallel':
      return 'composition.parallel'
    case 'pipeline':
      return 'composition.pipeline'
    case 'consensus':
      return 'composition.consensus'
    case 'swarm':
      return 'composition.swarm'
    default:
      return undefined
  }
}

function compositionAgentRefs(callName: string, objectArg: ts.ObjectLiteralExpression | undefined): string[] {
  if (!objectArg) return []
  switch (callName) {
    case 'parallel':
    case 'swarm':
      return identifierObjectValuesProperty(objectArg, 'agents')
    case 'consensus':
      return identifierArrayProperty(objectArg, 'agents')
    case 'pipeline':
      return pipelineStepAgentRefs(objectArg)
    default:
      return []
  }
}

function identifierObjectValuesProperty(object: ts.ObjectLiteralExpression, name: string): string[] {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  if (!property || !ts.isObjectLiteralExpression(property.initializer)) return []
  return property.initializer.properties
    .map((item) => {
      if (ts.isShorthandPropertyAssignment(item)) return item.name.text
      if (ts.isPropertyAssignment(item) && ts.isIdentifier(item.initializer)) return item.initializer.text
      return undefined
    })
    .filter((value): value is string => typeof value === 'string')
}

function pipelineStepAgentRefs(object: ts.ObjectLiteralExpression): string[] {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === 'steps')
  if (!property || !ts.isArrayLiteralExpression(property.initializer)) return []
  return property.initializer.elements
    .map((element) => {
      if (!ts.isObjectLiteralExpression(element)) return undefined
      return pipelineStageTarget(element).variable
    })
    .filter((value): value is string => typeof value === 'string')
}
