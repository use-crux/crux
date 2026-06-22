import { foldedIndexChild } from '../index-presentation'
import { facts, type ExtractContext, type ExtractResult } from '../extensions'
import type { StaticObjectReader } from '../extensions/types'
import { internalStaticRecordContext } from '../extensions/internal-native'
import {
  createStaticRecordSourceResolver,
  staticRecordProjectSourceRef,
} from '../extensions/static-record-source-resolver'
import type { ProjectSourceRef } from '@crux/core/project-index'
import { staticObjectPropertyValue, staticObjectValue } from '../static/syntax-record/value'
import { fallbackFactsFromRecordContext } from './routing-record-fallback'
import { routingTargetRelationRefs } from './routing-record-targets'

/** Projects record-backed routing facts from stable config readers. */
export function routingFactsFromRecordContext(ctx: ExtractContext): ExtractResult {
  if (!isDirectRecordRoutingCall(ctx)) return { kind: 'none' }
  if (ctx.match.name === 'router') return routerFactsFromRecordContext(ctx)
  if (ctx.match.name === 'cascade') return cascadeFactsFromRecordContext(ctx)
  if (ctx.match.name === 'fallback') return fallbackFactsFromRecordContext(ctx)
  return { kind: 'none' }
}

function isDirectRecordRoutingCall(ctx: ExtractContext): boolean {
  const recordCtx = internalStaticRecordContext(ctx)
  return recordCtx?.match.kind === 'call' && recordCtx.match.callee.direct !== false
}

function routerFactsFromRecordContext(ctx: ExtractContext): ExtractResult {
  if (!ctx.config) return { kind: 'none' }
  const routes = ctx.config.objectMapIdentifierEntries('routes')
  if (routes.length === 0) return { kind: 'none' }

  const authoredId = ctx.config.string('id')
  const routingId = authoredId ?? ctx.source.variableName
  const id = `routing.router:${ctx.source.safeId(routingId)}`
  const routeChildren = routes.map((route, index) => {
    const definitionId = `${id}:route:${ctx.source.safeId(route.key)}`
    const definition = ctx.define.definition({
      variableName: ctx.source.variableName,
      id: definitionId,
      kind: 'routing.router.route',
      name: route.key,
      metadata: {
        routerDefinitionId: id,
        routingId,
        routeKey: route.key,
        index,
        isDefault: route.key === 'default',
        indexPresentation: foldedIndexChild({
          parentDefinitionId: id,
          parentRelationType: 'router.includes_route',
          role: 'route',
          order: index,
        }),
        targetVariable: route.value,
        facts: {
          kind: 'routing.router.route',
          parentDefinitionId: id,
          routingId,
          routeKey: route.key,
          isDefault: route.key === 'default',
          targetVariable: route.value,
        },
        intelligence: {
          confidence: 'static',
          control: { mode: 'routing', ordering: 'conditional' },
        },
      },
    }).definition
    return { definition, routeKey: route.key, targetVariable: route.value }
  })
  const routeKeys = routeChildren.map((child) => child.routeKey)
  const classifyRef = ctx.sourceRef.callbackProperty({
    property: 'classify',
    role: 'callback',
    definitionId: id,
  })

  return facts({
    definitions: [
      {
        variableName: ctx.source.variableName,
        definition: ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'routing.router',
          name: routingId,
          metadata: {
            exportName: ctx.source.variableName,
            routingId,
            hasStableId: Boolean(authoredId),
            ...(authoredId ? { authoredId } : {}),
            routeKeys,
            routeCount: routeKeys.length,
            hasDefaultRoute: routeKeys.includes('default'),
            hasClassify: ctx.config.has('classify'),
            facts: {
              kind: 'routing.router',
              routingId,
              hasStableId: Boolean(authoredId),
              routeKeys,
              routeCount: routeKeys.length,
              hasDefaultRoute: routeKeys.includes('default'),
              hasClassify: ctx.config.has('classify'),
            },
            intelligence: {
              confidence: 'static',
              control: {
                mode: 'routing',
                ordering: 'conditional',
                children: routeChildren.map((child) => child.definition.id),
              },
            },
          },
        }).definition,
        extraDefinitions: routeChildren.map((child) => child.definition),
      },
    ],
    references: [
      ...routeChildren.map((child) => ({ type: 'router.includes_route', toId: child.definition.id })),
      ...routeChildren.flatMap((child) =>
        routingTargetRelationRefs(child.definition.id, child.targetVariable, 'router.route'),
      ),
    ],
    sourceRefs: classifyRef ? [classifyRef] : [],
  })
}

function cascadeFactsFromRecordContext(ctx: ExtractContext): ExtractResult {
  if (!ctx.config) return { kind: 'none' }
  const tiers = ctx.config.objectArray('tiers')
  if (tiers.length === 0) return { kind: 'none' }

  const authoredId = ctx.config.string('id')
  const routingId = authoredId ?? ctx.source.variableName
  const id = `routing.cascade:${ctx.source.safeId(routingId)}`
  const tierChildren = tiers.map((tier, index) => {
    const definitionId = `${id}:tier:${index + 1}`
    const targetVariable = tier.reference('model')
    const sourceRefs = cascadeTierSourceRefs(ctx, index, definitionId)
    const definition = ctx.define.definition({
      variableName: ctx.source.variableName,
      id: definitionId,
      kind: 'routing.cascade.tier',
      name: `tier ${index + 1}`,
      metadata: {
        cascadeDefinitionId: id,
        routingId,
        tierIndex: index,
        indexPresentation: foldedIndexChild({
          parentDefinitionId: id,
          parentRelationType: 'cascade.includes_tier',
          role: 'tier',
          order: index,
        }),
        ...(targetVariable ? { targetVariable, modelVariable: targetVariable } : {}),
        budget: tier.number('budget'),
        note: tier.string('note'),
        hasEvaluate: tier.has('evaluate'),
        facts: {
          kind: 'routing.cascade.tier',
          parentDefinitionId: id,
          routingId,
          tierIndex: index,
          ...(targetVariable ? { targetVariable } : {}),
          hasEvaluate: tier.has('evaluate'),
        },
        intelligence: {
          confidence: 'static',
          control: { mode: 'cascade', ordering: 'ordered' },
        },
      },
    }).definition
    return { definition: sourceRefs.length > 0 ? { ...definition, sourceRefs: [...sourceRefs] } : definition, targetVariable }
  })

  return facts({
    definitions: [
      {
        variableName: ctx.source.variableName,
        definition: ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'routing.cascade',
          name: routingId,
          metadata: {
            exportName: ctx.source.variableName,
            routingId,
            hasStableId: Boolean(authoredId),
            ...(authoredId ? { authoredId } : {}),
            tierCount: tierChildren.length,
            hasBudget: ctx.config.has('budget'),
            budget: objectMetadata(ctx.config, 'budget'),
            facts: {
              kind: 'routing.cascade',
              routingId,
              hasStableId: Boolean(authoredId),
              tierCount: tierChildren.length,
              hasBudget: ctx.config.has('budget'),
              budget: objectMetadata(ctx.config, 'budget'),
            },
            intelligence: {
              confidence: 'static',
              control: {
                mode: 'cascade',
                ordering: 'ordered',
                children: tierChildren.map((child) => child.definition.id),
              },
            },
          },
        }).definition,
        extraDefinitions: tierChildren.map((child) => child.definition),
      },
    ],
    references: [
      ...tierChildren.map((child) => ({ type: 'cascade.includes_tier', toId: child.definition.id })),
      ...tierChildren.flatMap((child) =>
        routingTargetRelationRefs(child.definition.id, child.targetVariable, 'cascade.tier'),
      ),
    ],
  })
}

function cascadeTierSourceRefs(
  ctx: ExtractContext,
  index: number,
  definitionId: string,
): readonly ProjectSourceRef[] {
  const recordCtx = internalStaticRecordContext(ctx)
  if (!recordCtx?.objectArg) return []
  const tiers = staticObjectPropertyValue(recordCtx.objectArg, 'tiers')
  const tier = tiers?.kind === 'array' ? staticObjectValue(tiers.elements[index], recordCtx.initializers) : undefined
  if (!tier) return []
  const evaluate = staticObjectPropertyValue(tier, 'evaluate')
  const resolver = createStaticRecordSourceResolver({
    record: recordCtx.record,
    initializers: recordCtx.initializers,
    initializerRecords: recordCtx.initializerRecords,
    ...(recordCtx.recordsByFile ? { recordsByFile: recordCtx.recordsByFile } : {}),
  })
  const resolved = resolver.resolveValue(evaluate)
  return resolved
    ? [
        staticRecordProjectSourceRef({
          definitionId,
          role: 'callback',
          property: 'evaluate',
          resolved,
        }),
      ]
    : []
}

function objectMetadata(config: StaticObjectReader, property?: string): Record<string, unknown> | undefined {
  const value = config.json(property)
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}
