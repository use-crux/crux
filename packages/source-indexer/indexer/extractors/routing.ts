import ts from 'typescript'
import type { ProjectDefinition, ProjectSourceRef } from '@crux/core/catalog'
import { callbackSourceRefForProperty, projectSourceRef, resolveIdentifierSourceNode } from '../ast/source-refs'
import { literalValue, numericLiteralValue, propertyName, stringProperty } from '../ast/literals'
import { foldedCatalogChild } from '../catalog-presentation'
import type { StaticRelationRef } from '../types'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'

type RoutingTargetOwner = 'router.route' | 'cascade.tier' | 'fallback.option'

export const routingExtractor: PrimitiveExtractor = {
  name: 'routing',
  capabilities: ['definition', 'relation', 'source', 'runtime-join', 'partial'],
  callNames: ['router', 'cascade', 'fallback'],
  extract: (ctx) => {
    if (!isDirectCall(ctx)) return undefined
    if (ctx.callName === 'router') return extractRouter(ctx)
    if (ctx.callName === 'cascade') return extractCascade(ctx)
    if (ctx.callName === 'fallback') return extractFallback(ctx)
    return undefined
  },
}

function extractRouter(ctx: Parameters<PrimitiveExtractor['extract']>[0]) {
  if (!ctx.objectArg) return undefined
  if (!objectProperty(ctx.objectArg, 'routes', ctx.localInitializers)) return undefined
  const authoredId = stringProperty(ctx.objectArg, 'id')
  const routingId = authoredId ?? ctx.variableName
  const id = `routing.router:${ctx.safeId(routingId)}`
  const routeChildren = routerRouteDefinitions(ctx, id, routingId)
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
    hasClassify: Boolean(propertyInitializer(ctx.objectArg, 'classify')),
    facts: {
      kind: 'routing.router',
      routingId,
      hasStableId: Boolean(authoredId),
      routeKeys,
      routeCount: routeKeys.length,
      hasDefaultRoute: routeKeys.includes('default'),
      hasClassify: Boolean(propertyInitializer(ctx.objectArg, 'classify')),
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
  return foundDefinition(
    ctx.variableName,
    classifyRef ? { ...definition, sourceRefs: [classifyRef] } : definition,
    [
      ...routeChildren.map((child) => ({ type: 'router.includes_route', toId: child.definition.id })),
      ...routeChildren.flatMap((child) => routingTargetRelationRefs(child.definition.id, child.targetVariable, 'router.route')),
    ],
    routeChildren.map((child) => child.definition),
  )
}

function extractCascade(ctx: Parameters<PrimitiveExtractor['extract']>[0]) {
  if (!ctx.objectArg) return undefined
  if (!arrayProperty(ctx.objectArg, 'tiers', ctx.localInitializers)) return undefined
  const authoredId = stringProperty(ctx.objectArg, 'id')
  const routingId = authoredId ?? ctx.variableName
  const id = `routing.cascade:${ctx.safeId(routingId)}`
  const tierChildren = cascadeTierDefinitions(ctx, id, routingId)
  const definition = ctx.define(id, 'routing.cascade', routingId, ctx.objectArg, {
    exportName: ctx.variableName,
    routingId,
    hasStableId: Boolean(authoredId),
    ...(authoredId ? { authoredId } : {}),
    tierCount: tierChildren.length,
    hasBudget: Boolean(propertyInitializer(ctx.objectArg, 'budget')),
    budget: objectLiteralMetadata(propertyInitializer(ctx.objectArg, 'budget')),
    facts: {
      kind: 'routing.cascade',
      routingId,
      hasStableId: Boolean(authoredId),
      tierCount: tierChildren.length,
      hasBudget: Boolean(propertyInitializer(ctx.objectArg, 'budget')),
      budget: objectLiteralMetadata(propertyInitializer(ctx.objectArg, 'budget')),
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
  return foundDefinition(
    ctx.variableName,
    definition,
    [
      ...tierChildren.map((child) => ({ type: 'cascade.includes_tier', toId: child.definition.id })),
      ...tierChildren.flatMap((child) => routingTargetRelationRefs(child.definition.id, child.targetVariable, 'cascade.tier')),
    ],
    tierChildren.map((child) => child.definition),
  )
}

function extractFallback(ctx: Parameters<PrimitiveExtractor['extract']>[0]) {
  if (ctx.call.arguments.length < 2) return undefined
  const options = fallbackOptions(ctx.call)
  const routingId = options && ts.isObjectLiteralExpression(options) ? stringProperty(options, 'id') : undefined
  const idName = routingId ?? ctx.variableName
  const id = `routing.fallback:${ctx.safeId(idName)}`
  const optionChildren = fallbackOptionDefinitions(ctx, id, routingId)
  const definition = ctx.define(id, 'routing.fallback', idName, options && ts.isObjectLiteralExpression(options) ? options : undefined, {
    exportName: ctx.variableName,
    hasStableId: Boolean(routingId),
    ...(routingId ? { routingId } : {}),
    optionCount: optionChildren.length,
    options: options && ts.isObjectLiteralExpression(options) ? objectLiteralMetadata(options) : undefined,
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
  })
  return foundDefinition(
    ctx.variableName,
    definition,
    [
      ...optionChildren.map((child) => ({ type: 'fallback.includes_option', toId: child.definition.id })),
      ...optionChildren.flatMap((child) => routingTargetRelationRefs(child.definition.id, child.targetVariable, 'fallback.option')),
    ],
    optionChildren.map((child) => child.definition),
  )
}

function isDirectCall(ctx: Parameters<PrimitiveExtractor['extract']>[0]): boolean {
  return ts.isIdentifier(ctx.call.expression) && ctx.call.expression.text === ctx.callName
}

interface RoutingChild {
  readonly definition: ProjectDefinition
  readonly routeKey?: string
  readonly targetVariable?: string
}

function routerRouteDefinitions(
  ctx: Parameters<PrimitiveExtractor['extract']>[0],
  routerDefinitionId: string,
  routingId: string,
): RoutingChild[] {
  if (!ctx.objectArg) return []
  const routes = objectProperty(ctx.objectArg, 'routes', ctx.localInitializers)
  if (!routes) return []
  return routes.properties.flatMap((property, index) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return []
    const routeKey = propertyName(property.name)
    if (!routeKey) return []
    const target = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
    const targetVariable = ts.isIdentifier(target) ? target.text : undefined
    const definitionId = `${routerDefinitionId}:route:${ctx.safeId(routeKey)}`
    const sourceRefs = targetSourceRefs(ctx, definitionId, 'routes', target)
    const definition = ctx.define(definitionId, 'routing.router.route', routeKey, undefined, {
      routerDefinitionId,
      routingId,
      routeKey,
      index,
      isDefault: routeKey === 'default',
      catalogPresentation: foldedCatalogChild({
        parentDefinitionId: routerDefinitionId,
        parentRelationType: 'router.includes_route',
        role: 'route',
        order: index,
      }),
      ...(targetVariable ? { targetVariable } : {}),
      ...(modelPreview(target, ctx.localInitializers) ? { modelPreview: modelPreview(target, ctx.localInitializers) } : {}),
      facts: {
        kind: 'routing.router.route',
        parentDefinitionId: routerDefinitionId,
        routingId,
        routeKey,
        isDefault: routeKey === 'default',
        ...(targetVariable ? { targetVariable } : {}),
      },
      intelligence: {
        confidence: 'static',
        control: { mode: 'routing', ordering: 'conditional' },
      },
    })
    return [{
      definition: sourceRefs.length > 0 ? { ...definition, sourceRefs } : definition,
      routeKey,
      targetVariable,
    }]
  })
}

function cascadeTierDefinitions(
  ctx: Parameters<PrimitiveExtractor['extract']>[0],
  cascadeDefinitionId: string,
  routingId: string,
): RoutingChild[] {
  if (!ctx.objectArg) return []
  const tiers = arrayProperty(ctx.objectArg, 'tiers', ctx.localInitializers)
  if (!tiers) return []
  return tiers.elements.flatMap((element, index) => {
    if (!ts.isObjectLiteralExpression(element)) return []
    const model = propertyInitializer(element, 'model')
    const targetVariable = model && ts.isIdentifier(model) ? model.text : undefined
    const definitionId = `${cascadeDefinitionId}:tier:${index + 1}`
    const evaluateRef = callbackSourceRefForProperty({
      root: ctx.root,
      file: ctx.file,
      sourceFile: ctx.sourceFile,
      object: element,
      property: 'evaluate',
      role: 'callback',
      definitionId,
      localInitializers: ctx.localInitializers,
    })
    const targetRefs = targetSourceRefs(ctx, definitionId, 'model', model)
    const definition = ctx.define(definitionId, 'routing.cascade.tier', `tier ${index + 1}`, element, {
      cascadeDefinitionId,
      routingId,
      tierIndex: index,
      catalogPresentation: foldedCatalogChild({
        parentDefinitionId: cascadeDefinitionId,
        parentRelationType: 'cascade.includes_tier',
        role: 'tier',
        order: index,
      }),
      ...(targetVariable ? { targetVariable, modelVariable: targetVariable } : {}),
      ...(modelPreview(model, ctx.localInitializers) ? { modelPreview: modelPreview(model, ctx.localInitializers) } : {}),
      budget: numericLiteralValue(propertyInitializer(element, 'budget')),
      note: stringProperty(element, 'note'),
      hasEvaluate: Boolean(propertyInitializer(element, 'evaluate')),
      facts: {
        kind: 'routing.cascade.tier',
        parentDefinitionId: cascadeDefinitionId,
        routingId,
        tierIndex: index,
        ...(targetVariable ? { targetVariable } : {}),
        hasEvaluate: Boolean(propertyInitializer(element, 'evaluate')),
      },
      intelligence: {
        confidence: 'static',
        control: { mode: 'cascade', ordering: 'ordered' },
      },
    })
    const sourceRefs = [...targetRefs, ...(evaluateRef ? [evaluateRef] : [])]
    return [{
      definition: sourceRefs.length > 0 ? { ...definition, sourceRefs } : definition,
      targetVariable,
    }]
  })
}

function fallbackOptionDefinitions(
  ctx: Parameters<PrimitiveExtractor['extract']>[0],
  fallbackDefinitionId: string,
  routingId: string | undefined,
): RoutingChild[] {
  const modelArgs = ctx.call.arguments.filter((argument) => argument !== fallbackOptions(ctx.call))
  return modelArgs.flatMap((argument, index) => {
    const targetVariable = ts.isIdentifier(argument) ? argument.text : undefined
    const definitionId = `${fallbackDefinitionId}:option:${index + 1}`
    const sourceRefs = targetSourceRefs(ctx, definitionId, 'model', argument)
    const definition = ctx.define(definitionId, 'routing.fallback.option', `option ${index + 1}`, undefined, {
      fallbackDefinitionId,
      ...(routingId ? { routingId } : {}),
      optionIndex: index,
      catalogPresentation: foldedCatalogChild({
        parentDefinitionId: fallbackDefinitionId,
        parentRelationType: 'fallback.includes_option',
        role: 'option',
        order: index,
      }),
      ...(targetVariable ? { targetVariable, modelVariable: targetVariable } : {}),
      ...(modelPreview(argument, ctx.localInitializers) ? { modelPreview: modelPreview(argument, ctx.localInitializers) } : {}),
      facts: {
        kind: 'routing.fallback.option',
        parentDefinitionId: fallbackDefinitionId,
        ...(routingId ? { routingId } : {}),
        optionIndex: index,
        ...(targetVariable ? { targetVariable } : {}),
      },
      intelligence: {
        confidence: 'static',
        control: { mode: 'fallback', ordering: 'ordered' },
      },
    })
    return [{
      definition: sourceRefs.length > 0 ? { ...definition, sourceRefs } : definition,
      targetVariable,
    }]
  })
}

function routingTargetRelationRefs(
  fromId: string,
  toVariable: string | undefined,
  owner: RoutingTargetOwner,
): StaticRelationRef[] {
  if (!toVariable) return []
  const types = routingTargetTypes(owner)
  return [{
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
  }]
}

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

function objectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.ObjectLiteralExpression | undefined {
  const initializer = propertyInitializer(object, name)
  const resolved = resolveIdentifierExpression(initializer, localInitializers)
  return resolved && ts.isObjectLiteralExpression(resolved) ? resolved : undefined
}

function arrayProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.ArrayLiteralExpression | undefined {
  const initializer = propertyInitializer(object, name)
  const resolved = resolveIdentifierExpression(initializer, localInitializers)
  return resolved && ts.isArrayLiteralExpression(resolved) ? resolved : undefined
}

function propertyInitializer(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && propertyName(item.name) === name,
  )
  if (!property) return undefined
  return ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
}

function resolveIdentifierExpression(
  expression: ts.Expression | undefined,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression | undefined {
  const unwrapped = expression ? unwrapExpression(expression) : undefined
  if (!unwrapped || !ts.isIdentifier(unwrapped)) return unwrapped
  return localInitializers.get(unwrapped.text) ?? unwrapped
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression
  }
  return current
}

function fallbackOptions(call: ts.CallExpression): ts.Expression | undefined {
  const last = call.arguments.at(-1)
  if (!last || !ts.isObjectLiteralExpression(last)) return undefined
  const hasOptionsShape = Boolean(
    stringProperty(last, 'id') ||
      stringProperty(last, 'description') ||
      propertyInitializer(last, 'timeout') ||
      propertyInitializer(last, 'timeoutMs') ||
      propertyInitializer(last, 'on') ||
      propertyInitializer(last, 'shouldFallback') ||
      propertyInitializer(last, 'onAttemptError'),
  )
  return hasOptionsShape ? last : undefined
}

function modelPreview(
  expression: ts.Expression | undefined,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): unknown {
  const resolved = resolveIdentifierExpression(expression, localInitializers)
  if (!resolved) return undefined
  const literal = literalValue(resolved)
  if (literal !== undefined) return literal
  if (ts.isObjectLiteralExpression(resolved)) {
    return objectLiteralMetadata(resolved)
  }
  return undefined
}

function objectLiteralMetadata(expression: ts.Expression | undefined): Record<string, unknown> | undefined {
  if (!expression || !ts.isObjectLiteralExpression(expression)) return undefined
  const entries = expression.properties.flatMap((property) => {
    if (!ts.isPropertyAssignment(property)) return []
    const key = propertyName(property.name)
    if (!key) return []
    const value = literalValue(property.initializer)
    return value === undefined ? [] : [[key, value] as const]
  })
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function targetSourceRefs(
  ctx: Parameters<PrimitiveExtractor['extract']>[0],
  definitionId: string,
  property: string,
  target: ts.Expression | undefined,
): ProjectSourceRef[] {
  const unwrapped = target ? unwrapExpression(target) : undefined
  if (!unwrapped || !ts.isIdentifier(unwrapped)) return []
  const resolved = resolveIdentifierSourceNode(ctx.root, ctx.file, ctx.sourceFile, unwrapped.text, ctx.localInitializers)
  if (!resolved) return []
  return [
    projectSourceRef({
      definitionId,
      role: 'config',
      property,
      resolved,
      metadata: { routingTarget: true },
    }),
  ]
}
