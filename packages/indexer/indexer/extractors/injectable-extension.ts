import { facts, type IndexExtractor, type ExtractContext, type ExtractedSourceRef } from '../extensions'
import { injectableStaticContributions, relationRefsForInjectionUse } from './injection-entries'

const injectionReturnProperties = ['contexts', 'tools', 'constraints', 'guardrails', 'metadata'] as const

/**
 * Extracts `injectable(...)` definitions and conservative static hints from their inject callback.
 *
 * The extractor does not execute `inject()`. It records the authored injectable contract, the callback
 * source, and any simple return-object contributions that can be seen safely in source.
 */
export const injectableIndexExtractor: IndexExtractor = {
  name: 'injectable',
  patterns: [{ kind: 'call', name: 'injectable' }],
  extract: (ctx) => {
    if (!ctx.config) return { kind: 'none' }
    const explicitId = ctx.config.string('id')
    const id = `injectable:${ctx.source.safeId(explicitId ?? ctx.source.localName)}`
    const inputSchema = ctx.sourceRef.schemaProperty({ property: 'input', definitionId: id })
    const contributions = injectableStaticContributions(ctx, injectionReturnProperties)
    const useEntries = contributions.useEntries
    const tools = contributions.tools
    const mayInject = contributions.mayInject
    const contributionFacts = contributions.contributionFacts
    const constraintReferences = contributions.constraintReferences
    const guardrailReferences = contributions.guardrailReferences
    const sourceRefs = [
      ...inputSchema.sourceRefs,
      ...injectableCallbackRefs(ctx, id),
      ...ctx.sourceRef.helperRefsForProperty({ property: 'inject', definitionId: id }),
    ]

    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'injectable',
          name: explicitId ?? ctx.source.variableName,
          metadata: {
            exportName: ctx.source.variableName,
            inputSchema: inputSchema.schema,
            facts: {
              kind: 'injectable',
              injectableId: explicitId,
              ...(useEntries.length > 0 ? { useEntries: [...useEntries] } : {}),
              ...(tools.facts ? { tools: tools.facts } : {}),
              ...(contributionFacts ? { contributions: contributionFacts } : {}),
              ...(mayInject.length > 0 ? { mayInject } : {}),
            },
            intelligence: {
              confidence: 'static',
              ...(inputSchema.schema ? { contract: { inputSchema: inputSchema.schema } } : {}),
              ...(useEntries.length > 0 ||
              tools.references.length > 0 ||
              constraintReferences.length > 0 ||
              guardrailReferences.length > 0
                ? {
                    dependencies: {
                      ...(useEntries.length > 0
                        ? { contexts: useEntries.flatMap((entry) => entry.variable ?? []) }
                        : {}),
                      ...(tools.references.length > 0 ? { tools: [...tools.references] } : {}),
                      ...(constraintReferences.length > 0 ? { constraints: [...constraintReferences] } : {}),
                      ...(guardrailReferences.length > 0 ? { guardrails: [...guardrailReferences] } : {}),
                    },
                  }
                : {}),
            },
          },
        }),
      ],
      sourceRefs,
      references: [
        ...relationRefsForInjectionUse('injectable', id, useEntries),
        ...tools.references.map((toVariable) => ({ type: 'injectable.uses_tool', fromId: id, toVariable })),
      ],
    })
  },
}

/**
 * Collects source refs for injectable callback authoring.
 *
 * The callback ref lets index consumers jump from an injectable definition to the function that produces runtime
 * contributions such as contexts or tools.
 */
function injectableCallbackRefs(ctx: ExtractContext, definitionId: string): readonly ExtractedSourceRef[] {
  return [ctx.sourceRef.callbackProperty({ property: 'inject', role: 'callback', definitionId })].filter(isDefined)
}

/** Removes absent source refs after conservative source-ref construction. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
