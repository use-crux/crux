import ts from 'typescript'
import { propertyName, stringProperty } from '../../ast/literals'
import type { SemanticAnalyzerView } from '../candidates'
import {
  isResolvableSourceExpression,
  propertyInitializer,
  resolveSemanticExpression,
  semanticResolvedKey,
  unwrapExpression,
} from './source-refs'

/**
 * Resolves an expression to an object literal, following source declarations
 * recursively.
 *
 * The `seen` set prevents cycles across declarations; each recursive branch
 * receives a new set so caller-owned state remains untouched.
 */
export function semanticObjectExpression(
  expression: ts.Expression,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): ts.ObjectLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression)
  if (ts.isObjectLiteralExpression(unwrapped)) return unwrapped
  if (!isResolvableSourceExpression(unwrapped)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, view)
  if (!resolved?.expression) return undefined
  const key = semanticResolvedKey(resolved)
  if (seen.has(key)) return undefined
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  return semanticObjectExpression(resolved.expression, view, nextSeen)
}

/** Returns a direct object literal property initializer. */
export function objectProperty(object: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralExpression | undefined {
  const property = propertyInitializer(object, name)
  return property && ts.isObjectLiteralExpression(toExpression(property))
    ? (toExpression(property) as ts.ObjectLiteralExpression)
    : undefined
}

/** Returns an object property after following resolvable source declarations. */
export function semanticObjectProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  view: SemanticAnalyzerView,
): ts.ObjectLiteralExpression | undefined {
  const property = propertyInitializer(object, name)
  return property ? semanticObjectExpression(toExpression(property), view, new Set()) : undefined
}

/** Returns a direct array literal property initializer. */
export function arrayProperty(object: ts.ObjectLiteralExpression, name: string): ts.ArrayLiteralExpression | undefined {
  const property = propertyInitializer(object, name)
  return property && ts.isArrayLiteralExpression(toExpression(property))
    ? (toExpression(property) as ts.ArrayLiteralExpression)
    : undefined
}

/** Returns an array property after following resolvable source declarations. */
export function semanticArrayProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  view: SemanticAnalyzerView,
): ts.ArrayLiteralExpression | undefined {
  const property = propertyInitializer(object, name)
  return property ? semanticArrayExpression(toExpression(property), view, new Set()) : undefined
}

/**
 * Resolves an expression to an array literal, following source declarations
 * recursively with cycle protection.
 */
export function semanticArrayExpression(
  expression: ts.Expression,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): ts.ArrayLiteralExpression | undefined {
  const unwrapped = unwrapExpression(expression)
  if (ts.isArrayLiteralExpression(unwrapped)) return unwrapped
  if (!isResolvableSourceExpression(unwrapped)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, view)
  if (!resolved?.expression) return undefined
  const key = semanticResolvedKey(resolved)
  if (seen.has(key)) return undefined
  const nextSeen = new Set(seen)
  nextSeen.add(key)
  return semanticArrayExpression(resolved.expression, view, nextSeen)
}

/** Reads a string-literal property after unwrapping harmless TypeScript wrappers. */
export function semanticStringLiteralProperty(object: ts.ObjectLiteralExpression, name: string): string | undefined {
  const initializer = propertyInitializer(object, name)
  if (!initializer) return undefined
  const expression = unwrapExpression(initializer)
  return ts.isStringLiteralLike(expression) ? expression.text : undefined
}

/** Detects whether the final `fallback(...)` argument is an options object. */
export function semanticFallbackOptions(call: ts.CallExpression): ts.ObjectLiteralExpression | undefined {
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

/** Returns one or more expressions represented by a property value. */
export function propertyExpressions(object: ts.ObjectLiteralExpression, name: string): ts.Expression[] {
  const property = propertyInitializer(object, name)
  if (!property) return []
  const expression = toExpression(property)
  return ts.isArrayLiteralExpression(expression)
    ? expression.elements.filter((item): item is ts.Expression => ts.isExpression(item))
    : [expression]
}

/** Returns expression elements from an array literal property. */
export function arrayPropertyExpressions(object: ts.ObjectLiteralExpression, name: string): ts.Expression[] {
  return arrayProperty(object, name)?.elements.filter((item): item is ts.Expression => ts.isExpression(item)) ?? []
}

/** Returns the value expression for object members that can carry values. */
export function objectMemberExpression(property: ts.ObjectLiteralElementLike): ts.Expression | undefined {
  if (ts.isShorthandPropertyAssignment(property)) return property.name
  if (ts.isPropertyAssignment(property)) return property.initializer
  return undefined
}

/** Returns the static property name for object literal members. */
export function semanticObjectPropertyName(property: ts.ObjectLiteralElementLike): string | undefined {
  if (
    ts.isPropertyAssignment(property) ||
    ts.isShorthandPropertyAssignment(property) ||
    ts.isMethodDeclaration(property)
  ) {
    return propertyName(property.name)
  }
  return undefined
}

/** Normalizes shorthand assignments to the expression they represent. */
export function toExpression(value: ts.Expression | ts.ShorthandPropertyAssignment): ts.Expression {
  return ts.isShorthandPropertyAssignment(value) ? value.name : value
}
