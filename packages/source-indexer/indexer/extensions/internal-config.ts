import ts from 'typescript'
import type { ExtractContext } from './types'
import { propertyName } from '../ast/literals'

/**
 * Private static parser payload used by config helpers that still need object-literal access.
 *
 * Stable extractor code should prefer `ctx.config`; this context exists for first-party cases where
 * relation metadata still depends on parser-owned TypeScript structures.
 */
interface StaticNativeContext {
  readonly objectArg?: ts.ObjectLiteralExpression
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
}

/** Resolves identifier references from a config property for first-party extractors that model dependency edges. */
export function internalIdentifierRefsForConfigProperty(ctx: ExtractContext, property: string): readonly string[] {
  const staticCtx = staticContext(ctx)
  if (!staticCtx?.objectArg) return []
  const assignment = staticCtx.objectArg.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === property,
  )
  if (!assignment) return []
  return identifierRefsFromExpression(assignment.initializer, staticCtx.localInitializers)
}

/** Reads tool dependencies from either array-style or object-map Crux config conventions. */
export function internalToolNamesForConfigProperty(ctx: ExtractContext, property: string): readonly string[] | undefined {
  const expression = propertyExpression(ctx, property)
  if (!expression) return undefined
  if (ts.isArrayLiteralExpression(expression)) {
    const names = expression.elements.filter((element): element is ts.Identifier => ts.isIdentifier(element)).map((element) => element.text)
    return names.length > 0 ? names : undefined
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const names = expression.properties
      .map((item) => (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item) ? propertyName(item.name) : undefined))
      .filter((value): value is string => typeof value === 'string')
    return names.length > 0 ? names : undefined
  }
  return undefined
}

/** Extracts handoff ids from authored agent config without exposing the underlying TypeScript nodes. */
export function internalHandoffIdsForConfigProperty(ctx: ExtractContext, property: string): readonly string[] {
  const expression = propertyExpression(ctx, property)
  if (!expression || !ts.isArrayLiteralExpression(expression)) return []
  return expression.elements
    .map((element) => {
      if (ts.isStringLiteralLike(element)) return element.text
      if (ts.isObjectLiteralExpression(element)) return stringPropertyFromObject(element, 'id')
      return undefined
    })
    .filter((value): value is string => typeof value === 'string')
}

/**
 * Authored object-map entry whose value is an identifier reference.
 *
 * Some Crux APIs use object maps where the property key is a catalog-facing label and the value is the
 * actual referenced binding. Keeping both lets extractors emit useful metadata and accurate relations.
 */
export interface InternalObjectMapIdentifierEntry {
  readonly key: string
  readonly value: string
}

/** Preserves both authored object-map keys and identifier values for relation/source-ref construction. */
export function internalObjectMapIdentifierEntries(
  ctx: ExtractContext,
  property: string,
): readonly InternalObjectMapIdentifierEntry[] {
  const expression = propertyExpression(ctx, property)
  if (!expression || !ts.isObjectLiteralExpression(expression)) return []
  return expression.properties.flatMap((item): InternalObjectMapIdentifierEntry[] => {
    if (ts.isShorthandPropertyAssignment(item)) return [{ key: item.name.text, value: item.name.text }]
    if (!ts.isPropertyAssignment(item)) return []
    const key = propertyName(item.name)
    return key && ts.isIdentifier(item.initializer) ? [{ key, value: item.initializer.text }] : []
  })
}

/** Finds the raw initializer for a named config property inside the unstable first-party static context. */
function propertyExpression(ctx: ExtractContext, property: string): ts.Expression | undefined {
  const staticCtx = staticContext(ctx)
  if (!staticCtx?.objectArg) return undefined
  const assignment = staticCtx.objectArg.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === property,
  )
  return assignment?.initializer
}

/** Reads a string literal property from an object literal used inside first-party config helpers. */
function stringPropertyFromObject(object: ts.ObjectLiteralExpression, property: string): string | undefined {
  const assignment = object.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === property,
  )
  return assignment && ts.isStringLiteralLike(assignment.initializer) ? assignment.initializer.text : undefined
}

/**
 * Resolves identifier references from an expression, including local arrays and spread elements.
 *
 * The `seen` set prevents cycles in local initializer aliases from recursing forever. The function
 * returns values rather than mutating caller state so extractors can compose refs deterministically.
 */
function identifierRefsFromExpression(
  expression: ts.Expression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
  seen: ReadonlySet<string> = new Set<string>(),
): readonly string[] {
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.flatMap((element) => {
      if (ts.isIdentifier(element)) return [element.text]
      if (ts.isSpreadElement(element)) return identifierRefsFromExpression(element.expression, localInitializers, seen)
      return []
    })
  }
  if (!ts.isIdentifier(expression)) return []
  if (seen.has(expression.text)) return []
  const nextSeen = new Set([...seen, expression.text])
  const resolved = localInitializers.get(expression.text)
  return resolved && ts.isArrayLiteralExpression(resolved)
    ? identifierRefsFromExpression(resolved, localInitializers, nextSeen)
    : []
}

/** Reads the parser-owned static context used by internal first-party config helpers. */
function staticContext(ctx: ExtractContext): StaticNativeContext | undefined {
  const staticCtx = ctx.unstableNative?.staticContext
  return isStaticNativeContext(staticCtx) ? staticCtx : undefined
}

/** Narrows the unstable native payload to the static context shape required by config helpers. */
function isStaticNativeContext(value: unknown): value is StaticNativeContext {
  return Boolean(value && typeof value === 'object' && 'localInitializers' in value)
}
