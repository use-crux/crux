import type { ProjectDefinition, ProjectDefinitionKind } from '@crux/core/project-index'
import { foldedIndexChild } from '../index-presentation'
import type { StaticRelationRef } from '../types'
import { facts, type IndexExtractor, type ExtractContext, type StaticObjectReader } from '../extensions'
import { internalObjectMapIdentifierEntries } from '../static-index/compatibility/syntax-record-bridge/config'

type CompositionTargetProperty = 'agent' | 'flow' | 'prompt' | 'tool'

/**
 * Internal folded child projection for composition primitives.
 *
 * The child carries both the index definition and optional relation target information so metadata,
 * child definitions, and unresolved relation refs can be derived from the same immutable value.
 */
interface CompositionChild {
  readonly definition: ProjectDefinition
  readonly targetVariable?: string
}

/**
 * Extracts composition primitives such as parallel, pipeline, consensus, and swarm.
 *
 * Composition extraction emits a parent definition, folded child definitions, target relations, and
 * structured control intelligence so index consumers can understand orchestration without parsing
 * source text.
 */
export const compositionIndexExtractor: IndexExtractor = {
  name: 'composition',
  patterns: [
    { kind: 'call', name: 'parallel' },
    { kind: 'call', name: 'pipeline' },
    { kind: 'call', name: 'consensus' },
    { kind: 'call', name: 'swarm' },
  ],
  extract: (ctx) => {
    const compositionKind = compositionKindForCall(ctx.match.name)
    if (!compositionKind) return { kind: 'none' }
    const id = `${compositionKind}:${ctx.source.safeId(ctx.source.variableName)}`
    const childDefinitions = compositionChildDefinitions(ctx, id)
    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: compositionKind,
          name: ctx.source.variableName,
          metadata: {
            exportName: ctx.source.variableName,
            ...compositionMetadata(ctx),
            facts: {
              kind: compositionKind,
              ...compositionMetadata(ctx),
            },
            intelligence: compositionIntelligence(ctx.match.name, childDefinitions),
          },
        }),
        ...childDefinitions.map((child) => ({
          variableName: ctx.source.variableName,
          definition: child.definition,
        })),
      ],
      references: [
        ...compositionAgentRefs(ctx).map((toVariable) => ({
          type: 'composition.uses_agent',
          typeByTargetKind: {
            agent: 'composition.uses_agent',
            flow: 'composition.uses_flow',
            prompt: 'composition.uses_prompt',
            tool: 'composition.uses_tool',
            'routing.router': 'composition.uses_routing',
            'routing.cascade': 'composition.uses_routing',
            'routing.fallback': 'composition.uses_routing',
          },
          toVariable,
        })),
        ...compositionStructuralRelationRefs(ctx, id),
        ...compositionChildRelationRefs(ctx.match.name, childDefinitions),
      ],
    })
  },
}

/** Builds parent composition metadata from stable config readers and derived child/control facts. */
function compositionMetadata(ctx: ExtractContext): Record<string, unknown> {
  if (!ctx.config) return {}
  if (ctx.match.name === 'consensus') {
    const participants = ctx.config.identifierArray('agents')
    const judge = ctx.config.identifier('judge')
    const scorer = ctx.config.identifier('scorer')
    return {
      ...(participants.length > 0 ? { participants } : {}),
      ...(judge ? { judge } : {}),
      ...(scorer ? { scorer } : {}),
    }
  }
  if (ctx.match.name === 'swarm') {
    const participants = internalObjectMapIdentifierEntries(ctx, 'agents').map((entry) => entry.value)
    const coordinator = ctx.config.string('startAgent')
    const blackboard = ctx.config.identifier('blackboard')
    const memories = ctx.config.identifierArray('memory')
    const singleMemory = ctx.config.identifier('memory')
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

/**
 * Builds unresolved relation refs from composition config fields.
 *
 * Direct agent/judge/scorer refs and folded child target refs are returned as values so relation
 * resolution can validate targets after imports are known.
 */
function compositionStructuralRelationRefs(ctx: ExtractContext, compositionId: string): readonly StaticRelationRef[] {
  if (!ctx.config) return []
  if (ctx.match.name === 'consensus') {
    const agents = ctx.config.identifierArray('agents').map((toVariable) => ({
      type: 'consensus.includes_agent',
      fromId: compositionId,
      toVariable,
    }))
    const judge = ctx.config.identifier('judge')
    const scorer = ctx.config.identifier('scorer')
    return [
      ...agents,
      ...(judge
        ? [
            {
              type: 'consensus.uses_judge',
              typeByTargetKind: {
                agent: 'consensus.uses_judge',
                scorer: 'consensus.uses_scorer',
              },
              fromId: compositionId,
              toVariable: judge,
            },
          ]
        : []),
      ...(scorer ? [{ type: 'consensus.uses_scorer', fromId: compositionId, toVariable: scorer }] : []),
    ]
  }
  if (ctx.match.name === 'swarm') {
    const agents = internalObjectMapIdentifierEntries(ctx, 'agents').map((entry) => ({
      type: 'swarm.includes_agent',
      fromId: compositionId,
      toVariable: entry.value,
    }))
    const coordinator = ctx.config.string('startAgent')
    const blackboard = ctx.config.identifier('blackboard')
    const memories = ctx.config.identifierArray('memory')
    const singleMemory = ctx.config.identifier('memory')
    return [
      ...agents,
      ...(coordinator
        ? [{ type: 'swarm.coordinated_by', fromId: compositionId, toId: `agent:${ctx.source.safeId(coordinator)}` }]
        : []),
      ...(blackboard ? [{ type: 'swarm.uses_blackboard', fromId: compositionId, toVariable: blackboard }] : []),
      ...(singleMemory ? [{ type: 'swarm.uses_memory', fromId: compositionId, toVariable: singleMemory }] : []),
      ...memories.map((toVariable) => ({ type: 'swarm.uses_memory', fromId: compositionId, toVariable })),
    ]
  }
  return []
}

/** Dispatches to the child-definition strategy for the matched composition primitive. */
function compositionChildDefinitions(ctx: ExtractContext, compositionId: string): readonly CompositionChild[] {
  if (!ctx.config) return []
  if (ctx.match.name === 'parallel') return parallelBranchDefinitions(ctx, compositionId)
  if (ctx.match.name === 'pipeline') return pipelineStageDefinitions(ctx, compositionId)
  return []
}

/** Converts object-map agents in `parallel(...)` into ordered folded branch definitions. */
function parallelBranchDefinitions(ctx: ExtractContext, compositionId: string): readonly CompositionChild[] {
  return internalObjectMapIdentifierEntries(ctx, 'agents').map((entry, index) => {
    const definition = projectDefinitionFromContext(ctx, {
      id: `${compositionId}:branch:${ctx.source.safeId(entry.key)}`,
      kind: 'composition.parallel.branch',
      name: entry.key,
      metadata: {
        compositionId,
        branchId: entry.key,
        indexPresentation: foldedIndexChild({
          parentDefinitionId: compositionId,
          parentRelationType: 'parallel.includes_branch',
          role: 'branch',
          order: index,
        }),
        targetVariable: entry.value,
        targetProperty: 'agent',
        facts: {
          kind: 'composition.parallel.branch',
          compositionId,
          branchId: entry.key,
          targetVariable: entry.value,
        },
        intelligence: {
          confidence: 'static',
          control: { mode: 'parallel', ordering: 'concurrent' },
        },
      },
    })
    return { definition, targetVariable: entry.value }
  })
}

/** Converts `pipeline({ steps: [...] })` stage configs into ordered folded stage definitions. */
function pipelineStageDefinitions(ctx: ExtractContext, compositionId: string): readonly CompositionChild[] {
  return (ctx.config?.objectArray('steps') ?? []).map((stage, index) => {
    const stageId = stage.string('name') ?? `stage-${index + 1}`
    const target = pipelineStageTarget(stage)
    const definition = projectDefinitionFromContext(ctx, {
      id: `${compositionId}:stage:${ctx.source.safeId(stageId)}`,
      kind: 'composition.pipeline.stage',
      name: stageId,
      metadata: {
        compositionId,
        stageId,
        index,
        indexPresentation: foldedIndexChild({
          parentDefinitionId: compositionId,
          parentRelationType: 'pipeline.includes_stage',
          role: 'stage',
          order: index,
        }),
        ...(target.variable ? { targetVariable: target.variable } : {}),
        ...(target.property ? { targetProperty: target.property } : {}),
        facts: {
          kind: 'composition.pipeline.stage',
          compositionId,
          stageId,
          index,
          ...(target.variable ? { targetVariable: target.variable } : {}),
        },
        intelligence: {
          confidence: 'static',
          control: { mode: 'sequential', ordering: 'ordered' },
        },
      },
    })
    return { definition, targetVariable: target.variable }
  })
}

/** Finds the first supported target property on a pipeline stage config. */
function pipelineStageTarget(stage: StaticObjectReader): {
  readonly variable?: string
  readonly property?: CompositionTargetProperty
} {
  for (const property of ['agent', 'flow', 'prompt', 'tool'] as const) {
    const variable = stage.identifier(property)
    if (variable) return { variable, property }
  }
  return {}
}

/** Converts folded child target metadata into unresolved composition target relations. */
function compositionChildRelationRefs(
  callName: string,
  children: readonly CompositionChild[],
): readonly StaticRelationRef[] {
  return children.flatMap((child) => {
    const compositionId = String(child.definition.metadata?.compositionId ?? '')
    const includesType =
      callName === 'parallel'
        ? 'parallel.includes_branch'
        : callName === 'pipeline'
          ? 'pipeline.includes_stage'
          : undefined
    const usesType =
      callName === 'parallel'
        ? 'parallel.branch.uses_agent'
        : callName === 'pipeline'
          ? 'pipeline.stage.uses_agent'
          : undefined
    if (!compositionId || !includesType || !usesType) return []
    return [
      { type: includesType, fromId: compositionId, toId: child.definition.id },
      ...(child.targetVariable
        ? [
            {
              type: usesType,
              typeByTargetKind: {
                agent: usesType,
                flow: callName === 'parallel' ? 'parallel.branch.uses_flow' : 'pipeline.stage.uses_flow',
                prompt: callName === 'parallel' ? 'parallel.branch.uses_prompt' : 'pipeline.stage.uses_prompt',
                tool: callName === 'parallel' ? 'parallel.branch.uses_tool' : 'pipeline.stage.uses_tool',
                'routing.router':
                  callName === 'parallel' ? 'parallel.branch.uses_routing' : 'pipeline.stage.uses_routing',
                'routing.cascade':
                  callName === 'parallel' ? 'parallel.branch.uses_routing' : 'pipeline.stage.uses_routing',
                'routing.fallback':
                  callName === 'parallel' ? 'parallel.branch.uses_routing' : 'pipeline.stage.uses_routing',
              },
              fromId: child.definition.id,
              toVariable: child.targetVariable,
            },
          ]
        : []),
    ]
  })
}

/**
 * Builds structured control intelligence for composition detail views.
 *
 * The payload captures execution mode, ordering, participants, stages, and judge/scorer hints without
 * requiring consumers to understand each source-level composition API.
 */
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
      ...(children.length > 0 ? { children: children.map((child) => child.definition.id) } : {}),
    },
    ...(children.length > 0 ? { children: children.map((child) => child.definition.id) } : {}),
  }
}

/** Maps a composition factory call to its index definition kind. */
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

/** Reads direct agent participant refs from composition config conventions. */
function compositionAgentRefs(ctx: ExtractContext): readonly string[] {
  if (!ctx.config) return []
  switch (ctx.match.name) {
    case 'parallel':
    case 'swarm':
      return internalObjectMapIdentifierEntries(ctx, 'agents').map((entry) => entry.value)
    case 'consensus':
      return ctx.config.identifierArray('agents')
    case 'pipeline':
      return ctx.config.objectArray('steps').flatMap((stage) => {
        const target = pipelineStageTarget(stage)
        return target.variable ? [target.variable] : []
      })
    default:
      return []
  }
}

/** Builds folded child definitions with source defaults inherited from the parent extractor context. */
function projectDefinitionFromContext(
  ctx: ExtractContext,
  input: {
    readonly id: string
    readonly kind: ProjectDefinitionKind
    readonly name: string
    readonly metadata: Readonly<Record<string, unknown>>
  },
): ProjectDefinition {
  return ctx.define.definition({
    variableName: ctx.source.variableName,
    id: input.id,
    kind: input.kind,
    name: input.name,
    metadata: input.metadata,
  }).definition
}
