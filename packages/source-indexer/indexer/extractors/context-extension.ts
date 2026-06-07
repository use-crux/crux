import type { StaticRelationRef } from '../types'
import { facts, type CatalogExtractor, type ExtractContext, type ExtractedSourceRef } from '../extensions'
import { internalDataAccessRefsForConfigProperties } from '../extensions/internal-data-access'
import { primitiveDataIntelligence, type PrimitiveDataAccessRef } from './data-access'
import {
  injectionUseEntriesForConfigProperty,
  relationRefsForInjectionUse,
  toolContributionsForConfigProperty,
} from './injection-entries'

const callbackProperties = ['resolve', 'render', 'handler', 'when', 'system', 'tools'] as const

/**
 * Extracts `context(...)` definitions from authored context configuration.
 *
 * Context extraction mirrors prompt extraction closely: it records identity, schemas, callback/source
 * refs, static intelligence, and data-access relations as immutable facts for later resolution.
 */
export const contextCatalogExtractor: CatalogExtractor = {
  name: 'context',
  patterns: [{ kind: 'call', name: 'context' }],
  extract: (ctx) => {
    if (!ctx.config) return { kind: 'none' }
    const explicitId = ctx.config.string('id')
    const id = `context:${ctx.source.safeId(explicitId ?? ctx.source.localName)}`
    const inputSchema = ctx.sourceRef.schemaProperty({ property: 'input', definitionId: id })
    const dataAccesses = internalDataAccessRefsForConfigProperties(ctx, callbackProperties)
    const dataIntelligence = primitiveDataIntelligence(dataAccesses)
    const useEntries = injectionUseEntriesForConfigProperty(ctx, 'use')
    const usedContexts = useEntries.flatMap((entry) => entry.variable ?? [])
    const tools = toolContributionsForConfigProperty(ctx, 'tools')
    const sourceRefs = [
      ...inputSchema.sourceRefs,
      ...contextCallbackRefs(ctx, id),
      ...ctx.sourceRef.templateInterpolations({ property: 'system', role: 'system', definitionId: id }),
      ...callbackProperties.flatMap((property) => ctx.sourceRef.helperRefsForProperty({ property, definitionId: id })),
    ]

    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'context',
          name: explicitId ?? ctx.source.variableName,
          metadata: {
            exportName: ctx.source.variableName,
            inputSchema: inputSchema.schema,
            isStatic: !ctx.config.has('input'),
            facts: {
              kind: 'context',
              ...(usedContexts.length > 0 ? { use: [...usedContexts] } : {}),
              ...(useEntries.length > 0 ? { useEntries: [...useEntries] } : {}),
              isStatic: !ctx.config.has('input'),
              ...(tools.facts ? { tools: tools.facts } : {}),
            },
            intelligence: {
              confidence: 'static',
              ...(inputSchema.schema ? { contract: { inputSchema: inputSchema.schema } } : {}),
              ...(dataIntelligence?.data ? { data: dataIntelligence.data } : {}),
              ...(usedContexts.length > 0 || tools.references.length > 0
                ? {
                    dependencies: {
                      ...(usedContexts.length > 0 ? { contexts: [...usedContexts] } : {}),
                      ...(tools.references.length > 0 ? { tools: [...tools.references] } : {}),
                    },
                  }
                : {}),
            },
          },
        }),
      ],
      sourceRefs,
      references: [
        ...relationRefsForInjectionUse('context', id, useEntries),
        ...tools.references.map((toVariable) => ({ type: 'context.uses_tool', fromId: id, toVariable })),
        ...dataAccessRelationRefs(id, dataAccesses),
      ],
    })
  },
}

/** Collects source refs for context loader/resolver callbacks and supporting static template values. */
function contextCallbackRefs(ctx: ExtractContext, definitionId: string): readonly ExtractedSourceRef[] {
  return [
    ctx.sourceRef.callbackProperty({ property: 'resolve', role: 'resolver', definitionId }),
    ctx.sourceRef.callbackProperty({ property: 'render', role: 'callback', definitionId }),
    ctx.sourceRef.callbackProperty({ property: 'handler', role: 'handler', definitionId }),
    ctx.sourceRef.callbackProperty({ property: 'when', role: 'policy', definitionId }),
    ctx.sourceRef.property({ property: 'system', role: 'system', definitionId, metadata: { fragment: true } }) ??
      ctx.sourceRef.callbackProperty({ property: 'system', role: 'system', definitionId }),
  ].filter(isDefined)
}

/** Converts observed context data access into unresolved read/write relation refs. */
function dataAccessRelationRefs(fromId: string, accesses: readonly PrimitiveDataAccessRef[]): StaticRelationRef[] {
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

/** Removes absent source refs after conservative source-ref construction. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
