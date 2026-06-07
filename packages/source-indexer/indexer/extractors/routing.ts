import ts from 'typescript'
import { callbackSourceRefForProperty } from '../ast/source-refs'
import { stringProperty } from '../ast/literals'
import type { ExtractedFacts } from '../extensions'
import {
  internalCascadeTierDefinitions,
  internalFallbackOptionDefinitions,
  internalFallbackOptions,
  internalRoutingArrayProperty,
  internalRoutingObjectLiteralMetadata,
  internalRoutingObjectProperty,
  internalRoutingPropertyInitializer,
  internalRouterRouteDefinitions,
  type InternalRoutingChild,
} from '../extensions/internal-routing-traversal'
import type { StaticRelationRef } from '../types'
import type { StaticCallContext } from './types'

type RoutingTargetOwner = 'router.route' | 'cascade.tier' | 'fallback.option'

/**
 * Projects parser-owned routing calls into immutable catalog facts.
 *
 * Routing-specific source reads for routes, tiers, options, target source refs, and model previews live
 * behind internal traversal helpers. This function chooses the routing primitive and delegates to the
 * appropriate catalog projection.
 */
export function routingFactsFromStaticContext(ctx: StaticCallContext): ExtractedFacts | undefined {
  if (!isDirectCall(ctx)) return undefined
  if (ctx.callName === 'router') return extractRouter(ctx)
  if (ctx.callName === 'cascade') return extractCascade(ctx)
  if (ctx.callName === 'fallback') return extractFallback(ctx)
  return undefined
}

/** Projects a `router({ routes })` declaration into a router definition, route children, and route relations. */
function extractRouter(ctx: StaticCallContext): ExtractedFacts | undefined {
  if (!ctx.objectArg) return undefined
  if (!internalRoutingObjectProperty(ctx.objectArg, 'routes', ctx.localInitializers)) return undefined
  const authoredId = stringProperty(ctx.objectArg, 'id')
  const routingId = authoredId ?? ctx.variableName
  const id = `routing.router:${ctx.safeId(routingId)}`
  const routeChildren = internalRouterRouteDefinitions(ctx, id, routingId)
  const routeKeys = routeChildren.map((child) => child.routeKey)
  const classifyRef = callbackSourceRefForProperty({
    root: ctx.root,
    file: ctx.file,
    sourceFile: ctx.sourceFile,
    object: ctx.objectArg,
    property: 'classify',
    role: 'callback',
    definitionId: id,
    localInitializers: ctx.localInitializers,
  })
  const definition = ctx.define(id, 'routing.router', routingId, ctx.objectArg, {
    exportName: ctx.variableName,
    routingId,
    hasStableId: Boolean(authoredId),
    ...(authoredId ? { authoredId } : {}),
    routeKeys,
    routeCount: routeKeys.length,
    hasDefaultRoute: routeKeys.includes('default'),
    hasClassify: Boolean(internalRoutingPropertyInitializer(ctx.objectArg, 'classify')),
    facts: {
      kind: 'routing.router',
      routingId,
      hasStableId: Boolean(authoredId),
      routeKeys,
      routeCount: routeKeys.length,
      hasDefaultRoute: routeKeys.includes('default'),
      hasClassify: Boolean(internalRoutingPropertyInitializer(ctx.objectArg, 'classify')),
    },
    intelligence: {
      confidence: 'static',
      control: {
        mode: 'routing',
        ordering: 'conditional',
        ...(routeChildren.length > 0 ? { children: routeChildren.map((child) => child.definition.id) } : {}),
      },
    },
  })
  return {
    definitions: [
      {
        variableName: ctx.variableName,
        definition: classifyRef ? { ...definition, sourceRefs: [classifyRef] } : definition,
        extraDefinitions: routeChildren.map((child) => child.definition),
      },
    ],
    references: [
      ...routeChildren.map((child) => ({ type: 'router.includes_route', toId: child.definition.id })),
      ...routeChildren.flatMap((child) =>
        routingTargetRelationRefs(child.definition.id, child.targetVariable, 'router.route'),
      ),
    ],
  }
}

/** Projects a `cascade({ tiers })` declaration into a cascade definition, tier children, and tier relations. */
function extractCascade(ctx: StaticCallContext): ExtractedFacts | undefined {
  if (!ctx.objectArg) return undefined
  if (!internalRoutingArrayProperty(ctx.objectArg, 'tiers', ctx.localInitializers)) return undefined
  const authoredId = stringProperty(ctx.objectArg, 'id')
  const routingId = authoredId ?? ctx.variableName
  const id = `routing.cascade:${ctx.safeId(routingId)}`
  const tierChildren = internalCascadeTierDefinitions(ctx, id, routingId)
  const definition = ctx.define(id, 'routing.cascade', routingId, ctx.objectArg, {
    exportName: ctx.variableName,
    routingId,
    hasStableId: Boolean(authoredId),
    ...(authoredId ? { authoredId } : {}),
    tierCount: tierChildren.length,
    hasBudget: Boolean(internalRoutingPropertyInitializer(ctx.objectArg, 'budget')),
    budget: internalRoutingObjectLiteralMetadata(internalRoutingPropertyInitializer(ctx.objectArg, 'budget')),
    facts: {
      kind: 'routing.cascade',
      routingId,
      hasStableId: Boolean(authoredId),
      tierCount: tierChildren.length,
      hasBudget: Boolean(internalRoutingPropertyInitializer(ctx.objectArg, 'budget')),
      budget: internalRoutingObjectLiteralMetadata(internalRoutingPropertyInitializer(ctx.objectArg, 'budget')),
    },
    intelligence: {
      confidence: 'static',
      control: {
        mode: 'cascade',
        ordering: 'ordered',
        ...(tierChildren.length > 0 ? { children: tierChildren.map((child) => child.definition.id) } : {}),
      },
    },
  })
  return {
    definitions: [
      {
        variableName: ctx.variableName,
        definition,
        extraDefinitions: tierChildren.map((child) => child.definition),
      },
    ],
    references: [
      ...tierChildren.map((child) => ({ type: 'cascade.includes_tier', toId: child.definition.id })),
      ...tierChildren.flatMap((child) =>
        routingTargetRelationRefs(child.definition.id, child.targetVariable, 'cascade.tier'),
      ),
    ],
  }
}

/** Projects a `fallback(...)` declaration into a fallback definition, option children, and option relations. */
function extractFallback(ctx: StaticCallContext): ExtractedFacts | undefined {
  if (ctx.call.arguments.length < 2) return undefined
  const options = internalFallbackOptions(ctx.call)
  const routingId = options && ts.isObjectLiteralExpression(options) ? stringProperty(options, 'id') : undefined
  const idName = routingId ?? ctx.variableName
  const id = `routing.fallback:${ctx.safeId(idName)}`
  const optionChildren = internalFallbackOptionDefinitions(ctx, id, routingId)
  const definition = ctx.define(
    id,
    'routing.fallback',
    idName,
    options && ts.isObjectLiteralExpression(options) ? options : undefined,
    {
      exportName: ctx.variableName,
      hasStableId: Boolean(routingId),
      ...(routingId ? { routingId } : {}),
      optionCount: optionChildren.length,
      options:
        options && ts.isObjectLiteralExpression(options) ? internalRoutingObjectLiteralMetadata(options) : undefined,
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
          ...(optionChildren.length > 0 ? { children: optionChildren.map((child) => child.definition.id) } : {}),
        },
      },
    },
  )
  return {
    definitions: [
      {
        variableName: ctx.variableName,
        definition,
        extraDefinitions: optionChildren.map((child) => child.definition),
      },
    ],
    references: [
      ...optionChildren.map((child) => ({ type: 'fallback.includes_option', toId: child.definition.id })),
      ...optionChildren.flatMap((child) =>
        routingTargetRelationRefs(child.definition.id, child.targetVariable, 'fallback.option'),
      ),
    ],
  }
}

/** Rejects property-access or otherwise indirect routing calls so static discovery stays conservative. */
function isDirectCall(ctx: StaticCallContext): boolean {
  return ts.isIdentifier(ctx.call.expression) && ctx.call.expression.text === ctx.callName
}

type RoutingChild = InternalRoutingChild

/**
 * Builds unresolved relation refs for route/tier/option target variables.
 *
 * The resolver later specializes these refs by target kind, allowing one authored target expression to
 * resolve to router, cascade, fallback, agent, or prompt relations.
 */
function routingTargetRelationRefs(
  fromId: string,
  toVariable: string | undefined,
  owner: RoutingTargetOwner,
): StaticRelationRef[] {
  if (!toVariable) return []
  const types = routingTargetTypes(owner)
  return [
    {
      type: types.router,
      typeByTargetKind: {
        'routing.router': types.router,
        'routing.cascade': types.cascade,
        ...(types.fallback ? { 'routing.fallback': types.fallback } : {}),
        agent: types.agent,
        prompt: types.prompt,
      },
      fromId,
      toVariable,
    },
  ]
}

/** Maps each routing child owner to the relation types it can emit after target-kind resolution. */
function routingTargetTypes(owner: RoutingTargetOwner): {
  router: string
  cascade: string
  fallback?: string
  agent: string
  prompt: string
} {
  if (owner === 'router.route') {
    return {
      router: 'router.route.uses_router',
      cascade: 'router.route.uses_cascade',
      fallback: 'router.route.uses_fallback',
      agent: 'router.route.uses_agent',
      prompt: 'router.route.uses_prompt',
    }
  }
  if (owner === 'cascade.tier') {
    return {
      router: 'cascade.tier.uses_router',
      cascade: 'cascade.tier.uses_cascade',
      fallback: 'cascade.tier.uses_fallback',
      agent: 'cascade.tier.uses_agent',
      prompt: 'cascade.tier.uses_prompt',
    }
  }
  return {
    router: 'fallback.option.uses_router',
    cascade: 'fallback.option.uses_cascade',
    fallback: 'fallback.option.uses_fallback',
    agent: 'fallback.option.uses_agent',
    prompt: 'fallback.option.uses_prompt',
  }
}
