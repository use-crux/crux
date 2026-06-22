import ts from 'typescript'
import type { ConfigReader, ExtractContext, StaticObjectMapIdentifierEntry } from './types'
import { propertyName } from '../ast/literals'
import { internalStaticCallContext, internalStaticRecordContext } from './internal-native'
import { resolveStaticSyntaxValue, staticObjectPropertyValue } from '../static/syntax-record/value'
import type { StaticSyntaxValue } from '../static/syntax-record/types'

/**
 * Private static parser payload used by config helpers that still need object-literal access.
 *
 * Stable extractor code should prefer `ctx.config`; this context exists for first-party cases where
 * relation metadata still depends on parser-owned TypeScript structures.
 */
/** Resolves identifier references from a config property for first-party extractors that model dependency edges. */
export function internalIdentifierRefsForConfigProperty(ctx: ExtractContext, property: string): readonly string[] {
  const staticCtx = internalStaticCallContext(ctx)
  if (!staticCtx) return configIdentifierRefs(ctx.config, property)
  if (!staticCtx?.objectArg) return []
  const assignment = staticCtx.objectArg.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === property,
  )
  if (!assignment) return []
  return identifierRefsFromExpression(assignment.initializer, staticCtx.localInitializers)
}

/** Reads tool dependencies from either array-style or object-map Crux config conventions. */
export function internalToolNamesForConfigProperty(
  ctx: ExtractContext,
  property: string,
): readonly string[] | undefined {
  const staticCtx = internalStaticCallContext(ctx)
  if (!staticCtx) return configToolNames(ctx.config, property)
  const expression = propertyExpression(ctx, property)
  if (!expression) return undefined
  if (ts.isArrayLiteralExpression(expression)) {
    const names = expression.elements
      .filter((element): element is ts.Identifier => ts.isIdentifier(element))
      .map((element) => element.text)
    return names.length > 0 ? names : undefined
  }
  if (ts.isObjectLiteralExpression(expression)) {
    const names = expression.properties
      .map((item) =>
        ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item) ? propertyName(item.name) : undefined,
      )
      .filter((value): value is string => typeof value === 'string')
    return names.length > 0 ? names : undefined
  }
  return undefined
}

/** Extracts handoff ids from authored agent config without exposing the underlying TypeScript nodes. */
export function internalHandoffIdsForConfigProperty(ctx: ExtractContext, property: string): readonly string[] {
  if (!internalStaticCallContext(ctx)) return configHandoffIds(ctx.config, property)
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
 * Some Crux APIs use object maps where the property key is a index-facing label and the value is the
 * actual referenced binding. Keeping both lets extractors emit useful metadata and accurate relations.
 */
export interface InternalObjectMapIdentifierEntry {
  readonly key: string
  readonly value: string
}

/** Static memory id information projected from a memory/blackboard config. */
export interface InternalAuthoredMemoryId {
  readonly definitionKey?: string
  readonly displayName?: string
  readonly runtimeIdPrefix?: string
}

/**
 * Computes the stable memory id information visible from an authored config.
 *
 * This understands literal ids, local id aliases, and the first-party `createMemoryId(...)` helper
 * without exposing those TypeScript expressions to `memory-extension.ts`.
 */
export function internalAuthoredMemoryId(ctx: ExtractContext): InternalAuthoredMemoryId {
  const staticCtx = internalStaticCallContext(ctx)
  if (!staticCtx) return recordAuthoredMemoryId(ctx) ?? configAuthoredMemoryId(ctx.config)
  const expression = propertyExpression(ctx, 'id')
  if (!expression || !staticCtx) return {}
  const initializer = resolveIdentifierExpression(expression, staticCtx.localInitializers)
  if (ts.isStringLiteralLike(initializer)) return { definitionKey: initializer.text, displayName: initializer.text }
  const prefix = createMemoryIdPrefix(initializer)
  if (prefix) {
    const key = prefix.endsWith(':') ? prefix.slice(0, -1) : prefix
    return { definitionKey: key, displayName: `${prefix}*`, runtimeIdPrefix: prefix }
  }
  if (ts.isIdentifier(expression)) return { definitionKey: expression.text, displayName: expression.text }
  return {}
}

function recordAuthoredMemoryId(ctx: ExtractContext): InternalAuthoredMemoryId | undefined {
  const recordCtx = internalStaticRecordContext(ctx)
  if (!recordCtx?.objectArg) return undefined
  const expression = staticObjectPropertyValue(recordCtx.objectArg, 'id')
  if (!expression) return undefined
  const initializer = resolveStaticSyntaxValue(expression, recordCtx.initializers)
  if (initializer?.kind === 'literal' && typeof initializer.value === 'string') {
    return { definitionKey: initializer.value, displayName: initializer.value }
  }
  const prefix = createMemoryIdPrefixFromRecord(initializer)
  if (prefix) {
    const key = prefix.endsWith(':') ? prefix.slice(0, -1) : prefix
    return { definitionKey: key, displayName: `${prefix}*`, runtimeIdPrefix: prefix }
  }
  if (expression.kind === 'identifier') return { definitionKey: expression.name, displayName: expression.name }
  return {}
}

/** Preserves both authored object-map keys and identifier values for relation/source-ref construction. */
export function internalObjectMapIdentifierEntries(
  ctx: ExtractContext,
  property: string,
): readonly InternalObjectMapIdentifierEntry[] {
  if (!internalStaticCallContext(ctx)) return configObjectMapIdentifierEntries(ctx.config, property)
  const expression = propertyExpression(ctx, property)
  if (!expression || !ts.isObjectLiteralExpression(expression)) return []
  return expression.properties.flatMap((item): InternalObjectMapIdentifierEntry[] => {
    if (ts.isShorthandPropertyAssignment(item)) return [{ key: item.name.text, value: item.name.text }]
    if (!ts.isPropertyAssignment(item)) return []
    const key = propertyName(item.name)
    return key && ts.isIdentifier(item.initializer) ? [{ key, value: item.initializer.text }] : []
  })
}

function configIdentifierRefs(config: ConfigReader | undefined, property: string): readonly string[] {
  if (!config) return []
  const identifiers = config.identifierArray(property)
  if (identifiers.length > 0) return uniqueStrings(identifiers)
  const identifier = config.identifier(property)
  return identifier ? [identifier] : []
}

function configToolNames(config: ConfigReader | undefined, property: string): readonly string[] | undefined {
  if (!config) return undefined
  const entries = config.objectMapIdentifierEntries(property)
  if (entries.length > 0) return entries.map((entry) => entry.key)
  const identifiers = config.identifierArray(property)
  return identifiers.length > 0 ? identifiers : undefined
}

function configHandoffIds(config: ConfigReader | undefined, property: string): readonly string[] {
  if (!config) return []
  return uniqueStrings([
    ...config.stringArray(property),
    ...config.objectArray(property).flatMap((item) => {
      const id = item.string('id')
      return id ? [id] : []
    }),
  ])
}

function configAuthoredMemoryId(config: ConfigReader | undefined): InternalAuthoredMemoryId {
  if (!config) return {}
  const literal = config.string('id')
  if (literal) return { definitionKey: literal, displayName: literal }
  const reference = config.reference('id')
  return reference ? { definitionKey: reference, displayName: reference } : {}
}

function configObjectMapIdentifierEntries(
  config: ConfigReader | undefined,
  property: string,
): readonly StaticObjectMapIdentifierEntry[] {
  return config?.objectMapIdentifierEntries(property) ?? []
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)]
}

/** Finds the raw initializer for a named config property inside the unstable first-party static context. */
function propertyExpression(ctx: ExtractContext, property: string): ts.Expression | undefined {
  const staticCtx = internalStaticCallContext(ctx)
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

/** Resolves one local identifier alias before projecting internal config values. */
function resolveIdentifierExpression(
  expression: ts.Expression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression {
  return ts.isIdentifier(expression) ? (localInitializers.get(expression.text) ?? expression) : expression
}

/** Reads `createMemoryId(...)` prefixes from local constants used in memory config. */
function createMemoryIdPrefix(expression: ts.Expression): string | undefined {
  if (!ts.isCallExpression(expression) || expressionName(expression.expression) !== 'createMemoryId') return undefined
  const [typeArg] = expression.arguments
  if (!typeArg || !ts.isStringLiteralLike(typeArg)) return undefined
  const prefix = memoryIdPrefixForType(typeArg.text)
  return prefix ? `${prefix}:` : undefined
}

function createMemoryIdPrefixFromRecord(expression: StaticSyntaxValue | undefined): string | undefined {
  if (expression?.kind !== 'call' || expression.callee.name !== 'createMemoryId') return undefined
  const [typeArg] = expression.args
  if (typeArg?.kind !== 'literal' || typeof typeArg.value !== 'string') return undefined
  const prefix = memoryIdPrefixForType(typeArg.value)
  return prefix ? `${prefix}:` : undefined
}

/** Maps memory factory names to their default index id prefixes. */
function memoryIdPrefixForType(type: string): string | undefined {
  switch (type) {
    case 'session':
      return 'session'
    case 'semantic':
      return 'project-knowledge'
    case 'episodic':
      return 'user-episodes'
    case 'blackboard':
      return 'thread'
    default:
      return undefined
  }
}

/** Reads the authored callee or final property name for internal config helper expressions. */
function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}
