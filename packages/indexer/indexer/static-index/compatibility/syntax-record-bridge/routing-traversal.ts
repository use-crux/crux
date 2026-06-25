import ts from 'typescript'
import type { ProjectDefinition, ProjectSourceRef } from '@crux/core/project-index'
import { literalValue, numericLiteralValue, propertyName, stringProperty } from '../../../ast/literals'
import { callbackSourceRefForProperty, projectSourceRef, resolveIdentifierSourceNode } from '../../../ast/source-refs'
import { foldedIndexChild } from '../../../index-presentation'
import type { StaticCallContext } from '../../../extractors/types'

/** Source-local routing child evidence used by the routing extractor projection layer. */
export interface InternalRoutingChild {
  readonly definition: ProjectDefinition
  readonly routeKey?: string
  readonly targetVariable?: string
}

/** Returns whether a config object has an object-valued property after local alias resolution. */
export function internalRoutingObjectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.ObjectLiteralExpression | undefined {
  const initializer = internalRoutingPropertyInitializer(object, name)
  const resolved = resolveIdentifierExpression(initializer, localInitializers)
  return resolved && ts.isObjectLiteralExpression(resolved) ? resolved : undefined
}

/** Returns whether a config object has an array-valued property after local alias resolution. */
export function internalRoutingArrayProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.ArrayLiteralExpression | undefined {
  const initializer = internalRoutingPropertyInitializer(object, name)
  const resolved = resolveIdentifierExpression(initializer, localInitializers)
  return resolved && ts.isArrayLiteralExpression(resolved) ? resolved : undefined
}

/** Locates a direct or shorthand property initializer from a routing config object. */
export function internalRoutingPropertyInitializer(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && propertyName(item.name) === name,
  )
  if (!property) return undefined
  return ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
}

/** Builds folded route child definitions for `router({ routes })`. */
export function internalRouterRouteDefinitions(
  ctx: StaticCallContext,
  routerDefinitionId: string,
  routingId: string,
): readonly InternalRoutingChild[] {
  if (!ctx.objectArg) return []
  const routes = internalRoutingObjectProperty(ctx.objectArg, 'routes', ctx.localInitializers)
  if (!routes) return []
  return routes.properties.flatMap((property, index): readonly InternalRoutingChild[] => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return []
    const routeKey = propertyName(property.name)
    if (!routeKey) return []
    const target = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
    const targetVariable = ts.isIdentifier(target) ? target.text : undefined
    const definitionId = `${routerDefinitionId}:route:${ctx.safeId(routeKey)}`
    const sourceRefs = internalRoutingTargetSourceRefs(ctx, definitionId, 'routes', target)
    const definition = ctx.define(definitionId, 'routing.router.route', routeKey, undefined, {
      routerDefinitionId,
      routingId,
      routeKey,
      index,
      isDefault: routeKey === 'default',
      indexPresentation: foldedIndexChild({
        parentDefinitionId: routerDefinitionId,
        parentRelationType: 'router.includes_route',
        role: 'route',
        order: index,
      }),
      ...(targetVariable ? { targetVariable } : {}),
      ...(internalRoutingModelPreview(target, ctx.localInitializers)
        ? { modelPreview: internalRoutingModelPreview(target, ctx.localInitializers) }
        : {}),
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
    return [
      {
        definition: sourceRefs.length > 0 ? { ...definition, sourceRefs } : definition,
        routeKey,
        targetVariable,
      },
    ]
  })
}

/** Builds folded cascade tier definitions for `cascade({ tiers })`. */
export function internalCascadeTierDefinitions(
  ctx: StaticCallContext,
  cascadeDefinitionId: string,
  routingId: string,
): readonly InternalRoutingChild[] {
  if (!ctx.objectArg) return []
  const tiers = internalRoutingArrayProperty(ctx.objectArg, 'tiers', ctx.localInitializers)
  if (!tiers) return []
  return tiers.elements.flatMap((element, index): readonly InternalRoutingChild[] => {
    if (!ts.isObjectLiteralExpression(element)) return []
    const model = internalRoutingPropertyInitializer(element, 'model')
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
    const targetRefs = internalRoutingTargetSourceRefs(ctx, definitionId, 'model', model)
    const definition = ctx.define(definitionId, 'routing.cascade.tier', `tier ${index + 1}`, element, {
      cascadeDefinitionId,
      routingId,
      tierIndex: index,
      indexPresentation: foldedIndexChild({
        parentDefinitionId: cascadeDefinitionId,
        parentRelationType: 'cascade.includes_tier',
        role: 'tier',
        order: index,
      }),
      ...(targetVariable ? { targetVariable, modelVariable: targetVariable } : {}),
      ...(internalRoutingModelPreview(model, ctx.localInitializers)
        ? { modelPreview: internalRoutingModelPreview(model, ctx.localInitializers) }
        : {}),
      budget: numericLiteralValue(internalRoutingPropertyInitializer(element, 'budget')),
      note: stringProperty(element, 'note'),
      hasEvaluate: Boolean(internalRoutingPropertyInitializer(element, 'evaluate')),
      facts: {
        kind: 'routing.cascade.tier',
        parentDefinitionId: cascadeDefinitionId,
        routingId,
        tierIndex: index,
        ...(targetVariable ? { targetVariable } : {}),
        hasEvaluate: Boolean(internalRoutingPropertyInitializer(element, 'evaluate')),
      },
      intelligence: {
        confidence: 'static',
        control: { mode: 'cascade', ordering: 'ordered' },
      },
    })
    const sourceRefs = [...targetRefs, ...(evaluateRef ? [evaluateRef] : [])]
    return [
      {
        definition: sourceRefs.length > 0 ? { ...definition, sourceRefs } : definition,
        targetVariable,
      },
    ]
  })
}

/** Builds folded fallback option definitions for `fallback(modelA, modelB, options?)`. */
export function internalFallbackOptionDefinitions(
  ctx: StaticCallContext,
  fallbackDefinitionId: string,
  routingId: string | undefined,
): readonly InternalRoutingChild[] {
  if (!ts.isCallExpression(ctx.call)) return []
  const call = ctx.call
  const modelArgs = call.arguments.filter((argument) => argument !== internalFallbackOptions(call))
  return modelArgs.flatMap((argument, index): readonly InternalRoutingChild[] => {
    const targetVariable = ts.isIdentifier(argument) ? argument.text : undefined
    const definitionId = `${fallbackDefinitionId}:option:${index + 1}`
    const sourceRefs = internalRoutingTargetSourceRefs(ctx, definitionId, 'model', argument)
    const definition = ctx.define(definitionId, 'routing.fallback.option', `option ${index + 1}`, undefined, {
      fallbackDefinitionId,
      ...(routingId ? { routingId } : {}),
      optionIndex: index,
      indexPresentation: foldedIndexChild({
        parentDefinitionId: fallbackDefinitionId,
        parentRelationType: 'fallback.includes_option',
        role: 'option',
        order: index,
      }),
      ...(targetVariable ? { targetVariable, modelVariable: targetVariable } : {}),
      ...(internalRoutingModelPreview(argument, ctx.localInitializers)
        ? { modelPreview: internalRoutingModelPreview(argument, ctx.localInitializers) }
        : {}),
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
    return [
      {
        definition: sourceRefs.length > 0 ? { ...definition, sourceRefs } : definition,
        targetVariable,
      },
    ]
  })
}

/** Returns fallback options when the final argument has the recognized options shape. */
export function internalFallbackOptions(call: ts.CallExpression): ts.Expression | undefined {
  const last = call.arguments.at(-1)
  if (!last || !ts.isObjectLiteralExpression(last)) return undefined
  const hasOptionsShape = Boolean(
    stringProperty(last, 'id') ||
    stringProperty(last, 'description') ||
    internalRoutingPropertyInitializer(last, 'timeout') ||
    internalRoutingPropertyInitializer(last, 'timeoutMs') ||
    internalRoutingPropertyInitializer(last, 'on') ||
    internalRoutingPropertyInitializer(last, 'shouldFallback') ||
    internalRoutingPropertyInitializer(last, 'onAttemptError'),
  )
  return hasOptionsShape ? last : undefined
}

/** Projects literal model metadata for route/tier/option detail panels. */
export function internalRoutingModelPreview(
  expression: ts.Expression | undefined,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): unknown {
  const resolved = resolveIdentifierExpression(expression, localInitializers)
  if (!resolved) return undefined
  const literal = literalValue(resolved)
  if (literal !== undefined) return literal
  if (ts.isObjectLiteralExpression(resolved)) return internalRoutingObjectLiteralMetadata(resolved)
  return undefined
}

/** Projects object-literal options metadata to JSON-like literals. */
export function internalRoutingObjectLiteralMetadata(
  expression: ts.Expression | undefined,
): Record<string, unknown> | undefined {
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

/** Returns source refs for identifier-valued routing targets. */
function internalRoutingTargetSourceRefs(
  ctx: StaticCallContext,
  definitionId: string,
  property: string,
  target: ts.Expression | undefined,
): ProjectSourceRef[] {
  const unwrapped = target ? unwrapExpression(target) : undefined
  if (!unwrapped || !ts.isIdentifier(unwrapped)) return []
  const resolved = resolveIdentifierSourceNode(
    ctx.root,
    ctx.file,
    ctx.sourceFile,
    unwrapped.text,
    ctx.localInitializers,
  )
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

/** Resolves one local identifier alias before object/array/model projection. */
function resolveIdentifierExpression(
  expression: ts.Expression | undefined,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression | undefined {
  const unwrapped = expression ? unwrapExpression(expression) : undefined
  if (!unwrapped || !ts.isIdentifier(unwrapped)) return unwrapped
  return localInitializers.get(unwrapped.text) ?? unwrapped
}

/** Removes TypeScript expression wrappers that should not change static routing interpretation. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
    current = current.expression
  }
  return current
}
