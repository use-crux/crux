import ts from 'typescript'
import { facts, type CatalogExtractor, type ExtractContext, type ExtractedSourceRef } from '../extensions'
import { propertyName } from '../ast/literals'
import {
  injectableReturnObject,
  injectionUseEntriesFromObjectProperty,
  relationRefsForInjectionUse,
  toolContributionsFromObjectProperty,
} from './injection-entries'

const injectionReturnProperties = ['contexts', 'tools', 'constraints', 'guardrails', 'metadata'] as const

/**
 * Extracts `injectable(...)` definitions and conservative static hints from their inject callback.
 *
 * The extractor does not execute `inject()`. It records the authored injectable contract, the callback
 * source, and any simple return-object contributions that can be seen safely in source.
 */
export const injectableCatalogExtractor: CatalogExtractor = {
  name: 'injectable',
  patterns: [{ kind: 'call', name: 'injectable' }],
  extract: (ctx) => {
    if (!ctx.config) return { kind: 'none' }
    const explicitId = ctx.config.string('id')
    const id = `injectable:${ctx.source.safeId(explicitId ?? ctx.source.localName)}`
    const inputSchema = ctx.sourceRef.schemaProperty({ property: 'input', definitionId: id })
    const returnObject = injectableReturnObject(ctx)
    const useEntries = returnObject ? injectionUseEntriesFromObjectProperty(ctx, returnObject, 'contexts') : []
    const tools = returnObject
      ? toolContributionsFromObjectProperty(returnObject, 'tools')
      : { facts: undefined, references: [] }
    const mayInject = returnObject
      ? injectionReturnProperties.filter((property) => hasReturnProperty(returnObject, property))
      : []
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
              ...(mayInject.length > 0 ? { mayInject } : {}),
            },
            intelligence: {
              confidence: 'static',
              ...(inputSchema.schema ? { contract: { inputSchema: inputSchema.schema } } : {}),
              ...(useEntries.length > 0 || tools.references.length > 0
                ? {
                    dependencies: {
                      ...(useEntries.length > 0
                        ? { contexts: useEntries.flatMap((entry) => entry.variable ?? []) }
                        : {}),
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
        ...relationRefsForInjectionUse('injectable', id, useEntries),
        ...tools.references.map((toVariable) => ({ type: 'injectable.uses_tool', fromId: id, toVariable })),
      ],
    })
  },
}

/**
 * Collects source refs for injectable callback authoring.
 *
 * The callback ref lets catalog consumers jump from an injectable definition to the function that produces runtime
 * contributions such as contexts or tools.
 */
function injectableCallbackRefs(ctx: ExtractContext, definitionId: string): readonly ExtractedSourceRef[] {
  return [ctx.sourceRef.callbackProperty({ property: 'inject', role: 'callback', definitionId })].filter(isDefined)
}

/**
 * Checks whether a returned contribution object advertises a specific injectable output property.
 *
 * This feeds the `mayInject` fact without inspecting values deeply, keeping the extractor conservative for dynamic
 * callback bodies.
 */
function hasReturnProperty(object: ts.ObjectLiteralExpression, property: string): boolean {
  return object.properties.some((item) => {
    if (!ts.isPropertyAssignment(item) && !ts.isShorthandPropertyAssignment(item)) return false
    return propertyName(item.name) === property
  })
}

/** Removes absent source refs after conservative source-ref construction. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
