import type { StaticRelationRef } from '../types'
import { facts, type IndexExtractor, type ExtractContext, type ExtractedSourceRef } from '../extensions'
import { internalIdentifierRefsForConfigProperty } from '../extensions/internal-config'
import { internalDataAccessRefsForConfigProperties } from '../extensions/internal-data-access'
import { primitiveDataIntelligence, type PrimitiveDataAccessRef } from './data-access'
import {
  injectionUseEntriesForConfigProperty,
  relationRefsForInjectionUse,
  toolContributionsForConfigProperty,
} from './injection-entries'

const callbackProperties = ['prompt', 'system', 'tools'] as const

/**
 * Extracts `prompt(...)` definitions from source-local prompt configuration.
 *
 * The extractor models prompt identity, contract schemas, static prompt intelligence, source refs for
 * prompt callbacks/templates/helpers, and visible data-access relations without mutating index state.
 */
export const promptIndexExtractor: IndexExtractor = {
  name: 'prompt',
  patterns: [{ kind: 'call', name: 'prompt' }],
  extract: (ctx) => {
    if (!ctx.config) return { kind: 'none' }
    const explicitId = ctx.config.string('id')
    const id = `prompt:${ctx.source.safeId(explicitId ?? ctx.source.localName)}`
    const inputSchema = ctx.sourceRef.schemaProperty({ property: 'input', definitionId: id })
    const outputSchema = ctx.sourceRef.schemaProperty({ property: 'output', definitionId: id })
    const dataAccesses = internalDataAccessRefsForConfigProperties(ctx, callbackProperties)
    const dataIntelligence = primitiveDataIntelligence(dataAccesses)
    const useEntries = injectionUseEntriesForConfigProperty(ctx, 'use')
    const usedContexts = useEntries.flatMap((entry) => entry.variable ?? [])
    const usedConstraints = internalIdentifierRefsForConfigProperty(ctx, 'constraints')
    const usedGuardrails = internalIdentifierRefsForConfigProperty(ctx, 'guardrails')
    const tools = toolContributionsForConfigProperty(ctx, 'tools')
    const sourceRefs = [
      ...inputSchema.sourceRefs,
      ...outputSchema.sourceRefs,
      ...promptCallbackRefs(ctx, id),
      ...ctx.sourceRef.templateInterpolations({ property: 'system', role: 'system', definitionId: id }),
      ...callbackProperties.flatMap((property) => ctx.sourceRef.helperRefsForProperty({ property, definitionId: id })),
    ]

    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'prompt',
          name: explicitId ?? ctx.source.variableName,
          metadata: {
            exportName: ctx.source.variableName,
            inputSchema: inputSchema.schema,
            outputSchema: outputSchema.schema,
            hasOutput: ctx.config.has('output'),
            facts: {
              kind: 'prompt',
              use: [...usedContexts],
              ...(useEntries.length > 0 ? { useEntries: [...useEntries] } : {}),
              ...(tools.facts ? { tools: tools.facts } : {}),
              ...(usedConstraints.length > 0 ? { constraints: [...usedConstraints] } : {}),
              ...(usedGuardrails.length > 0 ? { guardrails: [...usedGuardrails] } : {}),
              hasSystem: ctx.config.has('system'),
              hasPrompt: ctx.config.has('prompt'),
              hasMessages: ctx.config.has('messages'),
              hasTests: ctx.config.has('tests'),
            },
            intelligence: {
              confidence: 'static',
              ...(inputSchema.schema || outputSchema.schema
                ? {
                    contract: {
                      ...(inputSchema.schema ? { inputSchema: inputSchema.schema } : {}),
                      ...(outputSchema.schema ? { outputSchema: outputSchema.schema } : {}),
                    },
                  }
                : {}),
              ...(dataIntelligence?.data ? { data: dataIntelligence.data } : {}),
              ...(usedContexts.length > 0 ||
              tools.references.length > 0 ||
              usedConstraints.length > 0 ||
              usedGuardrails.length > 0
                ? {
                    dependencies: {
                      ...(usedContexts.length > 0 ? { contexts: [...usedContexts] } : {}),
                      ...(useEntries.some((entry) => entry.relationHint === 'injectable')
                        ? { injectables: useEntries.flatMap((entry) => entry.variable ?? []) }
                        : {}),
                      ...(tools.references.length > 0 ? { tools: [...tools.references] } : {}),
                      ...(usedConstraints.length > 0 ? { constraints: [...usedConstraints] } : {}),
                      ...(usedGuardrails.length > 0 ? { guardrails: [...usedGuardrails] } : {}),
                    },
                  }
                : {}),
            },
          },
        }),
      ],
      sourceRefs,
      references: [
        ...relationRefsForInjectionUse('prompt', id, useEntries),
        ...tools.references.map((toVariable) => ({ type: 'prompt.uses_tool', fromId: id, toVariable })),
        ...usedConstraints.map((fromVariable) => ({ type: 'constraint.applies_to', fromVariable, toId: id })),
        ...usedGuardrails.map((fromVariable) => ({ type: 'guardrail.applies_to', fromVariable, toId: id })),
        ...dataAccessRelationRefs(id, dataAccesses),
      ],
    })
  },
}

/**
 * Collects supplemental source refs that explain where prompt behavior is authored.
 *
 * Callback refs point to executable prompt construction and template refs point to constants used
 * inside static prompt text. Missing properties simply produce no refs.
 */
function promptCallbackRefs(ctx: ExtractContext, definitionId: string): readonly ExtractedSourceRef[] {
  return [
    ctx.sourceRef.callbackProperty({ property: 'prompt', role: 'prompt', definitionId }),
    ctx.sourceRef.property({ property: 'system', role: 'system', definitionId, metadata: { fragment: true } }) ??
      ctx.sourceRef.callbackProperty({ property: 'system', role: 'system', definitionId }),
  ].filter(isDefined)
}

/**
 * Converts primitive data-access observations into source-local relation refs.
 *
 * Reads and writes remain unresolved here; the relation resolver later validates targets and emits
 * index relations. This keeps extraction pure and independent of graph state.
 */
function dataAccessRelationRefs(fromId: string, accesses: readonly PrimitiveDataAccessRef[]): StaticRelationRef[] {
  return accesses.map((access) => ({
    type: access.kind === 'read' ? 'prompt.reads_memory' : 'prompt.writes_memory',
    typeByTargetKind:
      access.kind === 'read'
        ? {
            memory: 'prompt.reads_memory',
            blackboard: 'prompt.reads_blackboard',
            workspace: 'prompt.reads_workspace',
          }
        : {
            memory: 'prompt.writes_memory',
            blackboard: 'prompt.writes_blackboard',
            workspace: 'prompt.writes_workspace',
          },
    fromId,
    toVariable: access.targetVariable,
  }))
}

/** Removes absent source refs after conservative source-ref construction. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
