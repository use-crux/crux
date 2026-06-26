import type { SemanticAnalyzerNode, SemanticAnalyzerView } from '../candidates'
import {
  semanticIsResolvableSourceExpression,
  semanticPropertyInitializer,
  semanticPropertyName,
  semanticStringLiteralProperty as semanticSyntaxStringLiteralProperty,
} from '../syntax-readers'
import { resolveSemanticExpression, semanticResolvedKey } from './source-refs'

/**
 * Resolves an expression to an object literal, following source declarations
 * recursively.
 */
export function semanticObjectExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const unwrapped = view.syntax.unwrapExpression(expression)
  if (view.syntax.isKind(unwrapped, 'objectLiteral')) return unwrapped
  if (!semanticIsResolvableSourceExpression(unwrapped, view.syntax)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, view)
  if (!resolved?.expression) return undefined
  const key = semanticResolvedKey(resolved)
  if (seen.has(key)) return undefined
  return semanticObjectExpression(resolved.expression, view, new Set([...seen, key]))
}

/** Returns a direct object literal property initializer. */
export function objectProperty(
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const property = propertyInitializer(object, name, view)
  const expression = property ? toExpression(property, view) : undefined
  return expression && view.syntax.isKind(expression, 'objectLiteral') ? expression : undefined
}

/** Returns an object property after following resolvable source declarations. */
export function semanticObjectProperty(
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const property = propertyInitializer(object, name, view)
  return property ? semanticObjectExpression(toExpression(property, view), view, new Set()) : undefined
}

/** Returns a direct array literal property initializer. */
export function arrayProperty(
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const property = propertyInitializer(object, name, view)
  const expression = property ? toExpression(property, view) : undefined
  return expression && view.syntax.isKind(expression, 'arrayLiteral') ? expression : undefined
}

/** Returns an array property after following resolvable source declarations. */
export function semanticArrayProperty(
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const property = propertyInitializer(object, name, view)
  return property ? semanticArrayExpression(toExpression(property, view), view, new Set()) : undefined
}

/** Resolves an expression to an array literal with cycle protection. */
export function semanticArrayExpression(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  seen: Set<string>,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const unwrapped = view.syntax.unwrapExpression(expression)
  if (view.syntax.isKind(unwrapped, 'arrayLiteral')) return unwrapped
  if (!semanticIsResolvableSourceExpression(unwrapped, view.syntax)) return undefined
  const resolved = resolveSemanticExpression(unwrapped, view)
  if (!resolved?.expression) return undefined
  const key = semanticResolvedKey(resolved)
  if (seen.has(key)) return undefined
  return semanticArrayExpression(resolved.expression, view, new Set([...seen, key]))
}

/** Reads a string-literal property after unwrapping harmless wrappers. */
export function semanticStringLiteralProperty(
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
): string | undefined {
  return semanticStringLiteralPropertyFromSyntax(object, name, view)
}

/** Detects whether the final `fallback(...)` argument is an options object. */
export function semanticFallbackOptions(
  call: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  const last = view.syntax.callArguments(call).at(-1)
  if (!last || !view.syntax.isKind(last, 'objectLiteral')) return undefined
  const hasOptionsShape = Boolean(
    semanticStringLiteralPropertyFromSyntax(last, 'id', view) ||
      semanticStringLiteralPropertyFromSyntax(last, 'description', view) ||
      propertyInitializer(last, 'timeout', view) ||
      propertyInitializer(last, 'timeoutMs', view) ||
      propertyInitializer(last, 'on', view) ||
      propertyInitializer(last, 'shouldFallback', view) ||
      propertyInitializer(last, 'onAttemptError', view),
  )
  return hasOptionsShape ? last : undefined
}

/** Returns one or more expressions represented by a property value. */
export function propertyExpressions(
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView>[] {
  const property = propertyInitializer(object, name, view)
  if (!property) return []
  const expression = toExpression(property, view)
  return view.syntax.isKind(expression, 'arrayLiteral')
    ? view.syntax.arrayElements(expression).filter((element) => !view.syntax.spreadExpression(element))
    : [expression]
}

/** Returns expression elements from an array literal property. */
export function arrayPropertyExpressions(
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView>[] {
  const array = arrayProperty(object, name, view)
  return array ? view.syntax.arrayElements(array).filter((element) => !view.syntax.spreadExpression(element)) : []
}

/** Returns the value expression for object members that can carry values. */
export function objectMemberExpression(
  property: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  return view.syntax.propertyInitializer(property)
}

/** Returns the static property name for object literal members. */
export function semanticObjectPropertyName(
  property: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): string | undefined {
  return semanticPropertyName(property, view.syntax)
}

/** Returns the value expression for a named object property. */
export function propertyInitializer(
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> | undefined {
  return semanticPropertyInitializer(object, name, view.syntax)
}

/** Normalizes shorthand assignments to the expression they represent. */
export function toExpression(
  value: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): SemanticAnalyzerNode<SemanticAnalyzerView> {
  return view.syntax.propertyInitializer(value) ?? value
}

function semanticStringLiteralPropertyFromSyntax(
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  name: string,
  view: SemanticAnalyzerView,
): string | undefined {
  return semanticSyntaxStringLiteralProperty(object, name, view.syntax)
}
