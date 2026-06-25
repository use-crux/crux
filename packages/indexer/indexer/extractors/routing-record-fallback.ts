import { foldedIndexChild } from '../index-presentation'
import { facts, type ExtractContext, type ExtractResult } from '../extensions'
import type { StaticObjectReader } from '../extensions/public-contract/types'
import { internalStaticRecordContext } from '../static-index/compatibility/syntax-record-bridge/native-context'
import { staticObjectPropertyValue } from '../static/syntax-record/value'
import type { StaticSyntaxValue } from '../static/syntax-record/types'
import { routingTargetRelationRefs } from './routing-record-targets'

interface FallbackOptionEvidence {
  readonly targetVariable?: string
  readonly modelPreview?: unknown
}

/** Projects record-backed `fallback(...)` definitions and option children. */
export function fallbackFactsFromRecordContext(ctx: ExtractContext): ExtractResult {
  const options = fallbackOptions(ctx)
  if (options.length === 0) return { kind: 'none' }
  const routingId = ctx.config?.string('id')
  const idName = routingId ?? ctx.source.variableName
  const id = `routing.fallback:${ctx.source.safeId(idName)}`
  const optionChildren = options.map((option, index) => {
    const targetVariable = option.targetVariable
    const definitionId = `${id}:option:${index + 1}`
    const definition = ctx.define.definition({
      variableName: ctx.source.variableName,
      id: definitionId,
      kind: 'routing.fallback.option',
      name: `option ${index + 1}`,
      metadata: {
        fallbackDefinitionId: id,
        ...(routingId ? { routingId } : {}),
        optionIndex: index,
        indexPresentation: foldedIndexChild({
          parentDefinitionId: id,
          parentRelationType: 'fallback.includes_option',
          role: 'option',
          order: index,
        }),
        ...(targetVariable ? { targetVariable, modelVariable: targetVariable } : {}),
        ...(option.modelPreview ? { modelPreview: option.modelPreview } : {}),
        facts: {
          kind: 'routing.fallback.option',
          parentDefinitionId: id,
          ...(routingId ? { routingId } : {}),
          optionIndex: index,
          ...(targetVariable ? { targetVariable } : {}),
        },
        intelligence: {
          confidence: 'static',
          control: { mode: 'fallback', ordering: 'ordered' },
        },
      },
    }).definition
    return { definition, targetVariable }
  })

  return facts({
    definitions: [
      {
        variableName: ctx.source.variableName,
        definition: ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'routing.fallback',
          name: idName,
          metadata: {
            exportName: ctx.source.variableName,
            hasStableId: Boolean(routingId),
            ...(routingId ? { routingId } : {}),
            optionCount: optionChildren.length,
            ...(ctx.config ? { options: objectMetadata(ctx.config) } : {}),
            facts: {
              kind: 'routing.fallback',
              ...(routingId ? { routingId } : {}),
              hasStableId: Boolean(routingId),
              optionCount: optionChildren.length,
            },
            intelligence: {
              confidence: 'static',
              control: {
                mode: 'fallback',
                ordering: 'ordered',
                children: optionChildren.map((child) => child.definition.id),
              },
            },
          },
        }).definition,
        extraDefinitions: optionChildren.map((child) => child.definition),
      },
    ],
    references: [
      ...optionChildren.map((child) => ({ type: 'fallback.includes_option', toId: child.definition.id })),
      ...optionChildren.flatMap((child) =>
        routingTargetRelationRefs(child.definition.id, child.targetVariable, 'fallback.option'),
      ),
    ],
  })
}

function fallbackOptions(ctx: ExtractContext): readonly FallbackOptionEvidence[] {
  const recordCtx = internalStaticRecordContext(ctx)
  if (!recordCtx || recordCtx.match.kind !== 'call') return []
  const args = recordCtx.match.args.filter((arg, index, all) => !isFallbackOptionsArgument(arg, index, all.length))
  return args.map((arg) => ({
    ...(arg.kind === 'identifier' ? { targetVariable: arg.name } : {}),
    ...fallbackModelPreview(arg),
  }))
}

function isFallbackOptionsArgument(value: StaticSyntaxValue, index: number, argCount: number): boolean {
  if (index !== argCount - 1 || value.kind !== 'object') return false
  return ['id', 'description', 'timeout', 'timeoutMs', 'on', 'shouldFallback', 'onAttemptError'].some((property) =>
    Boolean(staticObjectPropertyValue(value, property)),
  )
}

function fallbackModelPreview(value: StaticSyntaxValue): { readonly modelPreview?: unknown } {
  if (value.kind === 'literal' && typeof value.value === 'string') return { modelPreview: value.value }
  if (value.kind === 'object') return { modelPreview: objectValuePreview(value) }
  return {}
}

function objectValuePreview(value: Extract<StaticSyntaxValue, { readonly kind: 'object' }>): Record<string, unknown> {
  return Object.fromEntries(
    value.properties.flatMap((property) =>
      !property.spread && property.value.kind === 'literal' ? [[property.name, property.value.value] as const] : [],
    ),
  )
}

function objectMetadata(config: StaticObjectReader, property?: string): Record<string, unknown> | undefined {
  const value = config.json(property)
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}
