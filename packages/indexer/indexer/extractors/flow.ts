import ts from 'typescript'
import { hasProperty, stringProperty } from '../ast/literals'
import { expressionToJsonSchema, schemaProperty } from '../ast/schemas'
import type { ExtractedFacts } from '../extensions'
import { internalFlowTraversal } from '../extensions/static-record-adapter/flow-traversal'
import type { StaticCallContext } from './types'
import { flowFactsFromEvidence } from './flow-facts'

/**
 * Projects a parser-owned `flow(...)` call into immutable index facts.
 *
 * The function owns index identity, folded step definitions, and relation refs. Source traversal for
 * steps/suspensions is delegated to `internalFlowTraversal` so this layer can stay focused on fact
 * projection while preserving the existing static compiler contract.
 */
export function flowFactsFromStaticContext(ctx: StaticCallContext): ExtractedFacts | undefined {
  if (ctx.callName !== 'flow' && ctx.callName !== 'cruxFlow') return undefined
  const explicitName = flowName(ctx)
  const flowDefinitionKey = explicitName ?? ctx.localName
  const traversal = internalFlowTraversal(ctx, flowDefinitionKey)
  const argsSchema = flowArgsSchema(ctx)
  return flowFactsFromEvidence({
    variableName: ctx.variableName,
    localName: ctx.localName,
    callName: ctx.callName,
    explicitName,
    args: ctx.objectArg ? objectPropertyKeys(ctx.objectArg, 'args') : undefined,
    argsSchema,
    hasArgs: ctx.objectArg ? hasProperty(ctx.objectArg, 'args') : false,
    traversal,
    safeId: ctx.safeId,
    define: (id, kind, name, metadata) => ctx.define(id, kind, name, undefined, metadata),
  })
}

/** Reads the authored flow name from either positional or object-style flow declarations. */
function flowName(ctx: StaticCallContext): string | undefined {
  if (ctx.firstArg && ts.isStringLiteralLike(ctx.firstArg)) return ctx.firstArg.text
  return ctx.objectArg ? stringProperty(ctx.objectArg, 'name') : undefined
}

/** Projects the flow argument contract from normal schema properties or Convex args objects. */
function flowArgsSchema(ctx: StaticCallContext): Record<string, unknown> | undefined {
  if (!ctx.objectArg) return undefined
  return (
    schemaProperty(ctx.objectArg, 'args', ctx.localInitializers) ??
    convexArgsSchema(ctx.objectArg, ctx.localInitializers)
  )
}

/**
 * Converts Convex-style `args` objects into JSON Schema using the shared schema projection helper.
 *
 * This preserves the previous static contract behavior for `cruxFlow({ args: ... })` without making
 * flow extraction responsible for general schema parsing.
 */
function convexArgsSchema(
  object: ts.ObjectLiteralExpression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): Record<string, unknown> | undefined {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === 'args',
  )
  if (!property) return undefined
  return expressionToJsonSchema(property.initializer, localInitializers)
}

/** Converts supported TypeScript property names into stable string keys for internal schema helpers. */
function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

/**
 * Returns object-literal keys from a named property for lightweight flow metadata.
 *
 * Unsupported property shapes return `undefined`; callers should treat that as unknown rather than an
 * empty authored contract.
 */
function objectPropertyKeys(object: ts.ObjectLiteralExpression, name: string): string[] | undefined {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name,
  )
  if (!property || !ts.isObjectLiteralExpression(property.initializer)) return undefined
  const keys = property.initializer.properties
    .map((item) => {
      if (!ts.isPropertyAssignment(item) && !ts.isShorthandPropertyAssignment(item)) return undefined
      return propertyName(item.name)
    })
    .filter((value): value is string => typeof value === 'string')
  return keys.length > 0 ? keys : undefined
}
