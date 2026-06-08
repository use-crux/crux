import type { StaticRelationRef } from '../types'
import { facts, type IndexExtractor, type ExtractContext } from '../extensions'
import {
  internalHandoffIdsForConfigProperty,
  internalIdentifierRefsForConfigProperty,
  internalToolNamesForConfigProperty,
} from '../extensions/internal-config'
import {
  internalDataAccessRefsForConfigObject,
  internalDataAccessRefsForConfigProperties,
} from '../extensions/internal-data-access'
import { primitiveDataIntelligence, type PrimitiveDataAccessRef } from './data-access'

const callbackProperties = ['handler', 'run', 'execute', 'contextHandler', 'usageHandler'] as const

/**
 * Extracts `agent(...)`, `createAgent(...)`, and `Agent` constructor definitions.
 *
 * Agent extraction records prompt/tool/handoff dependencies, visible state access, runtime join hints,
 * and handler source refs as immutable facts. Cross-file binding is deferred to relation resolution.
 */
export const agentIndexExtractor: IndexExtractor = {
  name: 'agent',
  patterns: [{ kind: 'call', name: 'agent' }],
  extract: (ctx) => {
    if (!ctx.config) return { kind: 'none' }
    const explicitId = ctx.config.string('id')
    const id = `agent:${ctx.source.safeId(explicitId ?? ctx.source.localName)}`
    const promptRef = ctx.config.identifier('prompt')
    const toolRefs = ctx.config.identifierArray('tools')
    const languageModelRef = ctx.config.identifier('languageModel')
    const handoffs = internalHandoffIdsForConfigProperty(ctx, 'handoffs')
    const usedConstraints = internalIdentifierRefsForConfigProperty(ctx, 'constraints')
    const usedGuardrails = internalIdentifierRefsForConfigProperty(ctx, 'guardrails')
    const dataAccesses = [
      ...internalDataAccessRefsForConfigObject(ctx),
      ...internalDataAccessRefsForConfigProperties(ctx, callbackProperties),
    ]
    const sourceRefs = [
      ...callbackProperties
        .map((property) =>
          ctx.sourceRef.callbackProperty({
            property,
            role: property === 'handler' ? 'handler' : property === 'execute' ? 'execute' : 'callback',
            definitionId: id,
          }),
        )
        .filter(isDefined),
      ...callbackProperties.flatMap((property) => ctx.sourceRef.helperRefsForProperty({ property, definitionId: id })),
    ]

    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'agent',
          name: explicitId ?? ctx.source.variableName,
          metadata: {
            exportName: ctx.source.variableName,
            toolNames: internalToolNamesForConfigProperty(ctx, 'tools'),
            handoffs,
            facts: {
              kind: 'agent',
              ...(promptRef ? { promptId: promptRef } : {}),
              ...(toolRefs.length > 0 ? { toolNames: [...toolRefs] } : {}),
              ...(handoffs.length > 0 ? { handoffs: [...handoffs] } : {}),
              ...(usedConstraints.length > 0 ? { constraints: [...usedConstraints] } : {}),
              ...(usedGuardrails.length > 0 ? { guardrails: [...usedGuardrails] } : {}),
            },
            intelligence: agentIntelligence(
              promptRef,
              toolRefs,
              handoffs,
              dataAccesses,
              usedConstraints,
              usedGuardrails,
            ),
          },
        }),
      ],
      sourceRefs,
      references: [
        ...(promptRef ? [{ type: 'agent.uses_prompt', toVariable: promptRef }] : []),
        ...toolRefs.map((toVariable) => ({ type: 'agent.uses_tool', toVariable })),
        ...(languageModelRef
          ? [
              {
                type: 'agent.uses_routing',
                typeByTargetKind: {
                  'routing.router': 'agent.uses_routing',
                  'routing.cascade': 'agent.uses_routing',
                  'routing.fallback': 'agent.uses_routing',
                },
                toVariable: languageModelRef,
              },
            ]
          : []),
        ...handoffs.map((handoffId) => ({
          type: 'agent.can_handoff_to',
          toId: `agent:${ctx.source.safeId(handoffId)}`,
        })),
        ...usedConstraints.map((fromVariable) => ({ type: 'constraint.applies_to', fromVariable, toId: id })),
        ...usedGuardrails.map((fromVariable) => ({ type: 'guardrail.applies_to', fromVariable, toId: id })),
        ...dataAccessRelationRefs(id, dataAccesses),
      ],
    })
  },
}

/**
 * Builds the structured `metadata.intelligence` payload consumed by index detail views.
 *
 * The shape groups prompt, tool, handoff, and data-access facts so consumers do not need to infer
 * agent structure from source snippets.
 */
function agentIntelligence(
  promptRef: string | undefined,
  toolRefs: readonly string[],
  handoffs: readonly string[],
  dataAccesses: readonly PrimitiveDataAccessRef[],
  constraints: readonly string[],
  guardrails: readonly string[],
): Record<string, unknown> | undefined {
  const data = primitiveDataIntelligence(dataAccesses)?.data
  if (
    !promptRef &&
    toolRefs.length === 0 &&
    handoffs.length === 0 &&
    constraints.length === 0 &&
    guardrails.length === 0 &&
    !data
  )
    return undefined
  return {
    confidence: 'static',
    control: {
      mode: handoffs.length > 0 ? 'event-driven' : 'immediate',
      ordering: 'event-driven',
    },
    dependencies: {
      ...(promptRef ? { prompt: promptRef } : {}),
      ...(promptRef ? { prompts: [promptRef] } : {}),
      ...(toolRefs.length > 0 ? { tools: [...toolRefs] } : {}),
      ...(handoffs.length > 0 ? { handoffs: [...handoffs] } : {}),
      ...(handoffs.length > 0 ? { agents: [...handoffs] } : {}),
      ...(constraints.length > 0 ? { constraints: [...constraints] } : {}),
      ...(guardrails.length > 0 ? { guardrails: [...guardrails] } : {}),
    },
    ...(data ? { data } : {}),
  }
}

/** Converts agent data-access observations into unresolved read/write relation refs. */
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

/** Removes absent source refs after conservative source-ref construction. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
