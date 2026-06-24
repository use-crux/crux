import ts from 'typescript'
import {
  identifierArrayProperty,
  identifierProperty,
  literalValue,
  numericLiteralValue,
  propertyName,
  stringArrayProperty,
  stringProperty,
} from '../../ast/literals'
import { schemaProperty } from '../../ast/schemas'
import type { StaticArgumentReader, StaticCallObjectReader, StaticObjectReader } from '../public-contract/types'

/** Projects a TypeScript object literal into the stable, JSON-like reader exposed to extractors. */
export function createStaticObjectReader(
  object: ts.ObjectLiteralExpression | undefined,
  localInitializers: ReadonlyMap<string, ts.Expression> = new Map(),
): StaticObjectReader | undefined {
  if (!object) return undefined
  return {
    has: (property) =>
      object.properties.some((item) => {
        if (!ts.isPropertyAssignment(item) && !ts.isShorthandPropertyAssignment(item)) return false
        return propertyName(item.name) === property
      }),
    string: (property) => stringProperty(object, property),
    number: (property) => numericLiteralValue(resolvedPropertyExpression(object, property, localInitializers)),
    boolean: (property) => {
      const value = literalValue(resolvedPropertyExpression(object, property, localInitializers))
      return typeof value === 'boolean' ? value : undefined
    },
    stringArray: (property) => stringArrayProperty(object, property) ?? [],
    identifier: (property) => identifierProperty(object, property),
    reference: (property) => referenceProperty(object, property, localInitializers),
    identifierArray: (property) => identifierArrayProperty(object, property),
    object: (property) => {
      const expression = resolvedPropertyExpression(object, property, localInitializers)
      return expression && ts.isObjectLiteralExpression(expression)
        ? createStaticObjectReader(expression, localInitializers)
        : undefined
    },
    objectArray: (property) =>
      objectArrayProperty(object, property, localInitializers)
        .map((item) => createStaticObjectReader(item, localInitializers))
        .filter(isDefined),
    callObject: (property) => callObjectProperty(object, property, localInitializers),
    callObjectArray: (property) => callObjectArrayProperty(object, property, localInitializers),
    nestedString: (path) => nestedStringProperty(object, path, localInitializers),
    objectMapIdentifiers: (property) => objectMapIdentifiers(object, property),
    objectMapIdentifierEntries: (property) => objectMapIdentifierEntries(object, property),
    schema: (property) => schemaProperty(object, property, localInitializers),
    json: (property) => staticJson(object, property, localInitializers),
  }
}

/**
 * Reads a single configured helper/factory call from an object property.
 *
 * Only calls whose first argument is an object literal are exposed. This covers config shapes such as
 * `store: upstashStore({ component: components.crux })` without leaking the native call expression.
 */
function callObjectProperty(
  object: ts.ObjectLiteralExpression,
  property: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): StaticCallObjectReader | undefined {
  const expression = resolvedPropertyExpression(object, property, localInitializers)
  if (!expression || !ts.isCallExpression(expression)) return undefined
  const firstArg = expression.arguments[0]
  if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) return undefined
  const config = createStaticObjectReader(firstArg, localInitializers)
  return config ? { name: expressionName(expression.expression), config } : undefined
}

/**
 * Reads an array of configured helper/factory calls from an object property.
 *
 * Only calls whose first argument is an object literal are exposed. Unsupported entries are skipped so
 * extractors can use this as a stable reader without needing native call expressions.
 */
function callObjectArrayProperty(
  object: ts.ObjectLiteralExpression,
  property: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): readonly StaticCallObjectReader[] {
  const expression = resolvedPropertyExpression(object, property, localInitializers)
  if (!expression || !ts.isArrayLiteralExpression(expression)) return []
  return expression.elements.flatMap((element): readonly StaticCallObjectReader[] => {
    const resolved = resolveIdentifierExpression(element as ts.Expression, localInitializers)
    if (!resolved || !ts.isCallExpression(resolved)) return []
    const firstArg = resolved.arguments[0]
    if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) return []
    const config = createStaticObjectReader(firstArg, localInitializers)
    return config ? [{ name: expressionName(resolved.expression), config }] : []
  })
}

/** Reads a nested string literal by following object-literal properties through local aliases. */
function nestedStringProperty(
  object: ts.ObjectLiteralExpression,
  path: readonly string[],
  localInitializers: ReadonlyMap<string, ts.Expression>,
): string | undefined {
  const resolved = path.reduce<ts.Expression | undefined>((current, segment) => {
    if (!current || !ts.isObjectLiteralExpression(current)) return undefined
    return resolvedPropertyExpression(current, segment, localInitializers)
  }, object)
  return resolved && ts.isStringLiteralLike(resolved) ? resolved.text : undefined
}

/** Projects call or constructor arguments into source-local literal readers for extractors. */
export function createStaticArgumentReader(
  args: readonly ts.Expression[],
  localInitializers: ReadonlyMap<string, ts.Expression> = new Map(),
): StaticArgumentReader {
  return {
    string: (index) => {
      const expression = resolvedArgumentExpression(args, index, localInitializers)
      return expression && ts.isStringLiteralLike(expression) ? expression.text : undefined
    },
    identifier: (index) => {
      const raw = args[index]
      if (raw && ts.isIdentifier(raw)) return raw.text
      const expression = resolvedArgumentExpression(args, index, localInitializers)
      return expression && ts.isIdentifier(expression) ? expression.text : undefined
    },
    object: (index) => {
      const expression = resolvedArgumentExpression(args, index, localInitializers)
      return expression && ts.isObjectLiteralExpression(expression)
        ? createStaticObjectReader(expression, localInitializers)
        : undefined
    },
    objectArray: (index) => {
      const expression = resolvedArgumentExpression(args, index, localInitializers)
      if (!expression || !ts.isArrayLiteralExpression(expression)) return []
      return expression.elements
        .filter((element): element is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(element))
        .map((item) => createStaticObjectReader(item, localInitializers))
        .filter(isDefined)
    },
    json: (index) => {
      const expression = resolvedArgumentExpression(args, index, localInitializers)
      return expression ? expressionJson(expression, localInitializers) : undefined
    },
  }
}

/**
 * Reads a property as an array of object literals for `ctx.config.objectArray(...)`.
 *
 * Missing properties, non-array values, and non-object elements are treated as empty because the stable
 * reader only exposes source shapes it can model safely.
 */
function objectArrayProperty(
  object: ts.ObjectLiteralExpression,
  property: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.ObjectLiteralExpression[] {
  const expression = resolvedPropertyExpression(object, property, localInitializers)
  if (!expression || !ts.isArrayLiteralExpression(expression)) return []
  return expression.elements.filter((element): element is ts.ObjectLiteralExpression =>
    ts.isObjectLiteralExpression(element),
  )
}

/**
 * Reads identifier-valued entries from an object-map property.
 *
 * This supports Crux APIs that accept maps such as `{ writer: writerTool }`, where the key is useful
 * metadata and the identifier value is the relation target. Non-identifier values are skipped rather
 * than exposed as unsafe AST nodes.
 */
function objectMapIdentifiers(object: ts.ObjectLiteralExpression, property: string): string[] {
  return objectMapIdentifierEntries(object, property).map((entry) => entry.value)
}

/** Reads object-map identifier entries from a direct object property. */
function objectMapIdentifierEntries(
  object: ts.ObjectLiteralExpression,
  property: string,
): Array<{ readonly key: string; readonly value: string }> {
  const expression = propertyExpression(object, property)
  if (!expression || !ts.isObjectLiteralExpression(expression)) return []
  return expression.properties
    .map((item) => {
      if (ts.isShorthandPropertyAssignment(item)) return { key: item.name.text, value: item.name.text }
      if (ts.isPropertyAssignment(item) && ts.isIdentifier(item.initializer)) {
        const key = propertyName(item.name)
        return key ? { key, value: item.initializer.text } : undefined
      }
      return undefined
    })
    .filter(isDefined)
}

/**
 * Reads a property as a conservative source reference name.
 *
 * Shorthand properties return their shorthand name. Identifier initializers return that identifier,
 * and property-access initializers return the final segment. Local identifier aliases are followed
 * once so simple constants preserve existing first-party extraction behavior.
 */
function referenceProperty(
  object: ts.ObjectLiteralExpression,
  property: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): string | undefined {
  const found = object.properties.find(
    (item): item is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && propertyName(item.name) === property,
  )
  if (!found) return undefined
  if (ts.isShorthandPropertyAssignment(found)) return found.name.text
  if (ts.isIdentifier(found.initializer) || ts.isPropertyAccessExpression(found.initializer))
    return expressionName(found.initializer)
  const resolved = resolveIdentifierExpression(found.initializer, localInitializers)
  return expressionName(resolved ?? found.initializer)
}

/**
 * Projects either a named property or an entire object literal into JSON-compatible data.
 *
 * Unsupported expressions return `undefined` so extractor output remains conservative and
 * deterministic.
 */
function staticJson(
  object: ts.ObjectLiteralExpression,
  property: string | undefined,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): unknown {
  const value = property ? resolvedPropertyExpression(object, property, localInitializers) : object
  return value ? expressionJson(value, localInitializers) : undefined
}

/** Locates a direct property assignment initializer without following identifiers. */
function propertyExpression(object: ts.ObjectLiteralExpression, property: string): ts.Expression | undefined {
  const found = object.properties.find(
    (item): item is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && propertyName(item.name) === property,
  )
  if (!found) return undefined
  return ts.isShorthandPropertyAssignment(found) ? found.name : found.initializer
}

/** Resolves a named property through local initializer aliases before reader projection. */
function resolvedPropertyExpression(
  object: ts.ObjectLiteralExpression,
  property: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression | undefined {
  return resolveIdentifierExpression(propertyExpression(object, property), localInitializers)
}

/** Resolves a positional argument through local initializer aliases before reader projection. */
function resolvedArgumentExpression(
  args: readonly ts.Expression[],
  index: number,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression | undefined {
  return resolveIdentifierExpression(args[index], localInitializers)
}

/**
 * Resolves one identifier alias when the initializer is available in the parser's local initializer map.
 *
 * Resolution is intentionally shallow. Deep interpretation belongs in focused helpers so the stable
 * reader does not become an implicit TypeScript evaluator.
 */
function resolveIdentifierExpression(
  expression: ts.Expression | undefined,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression | undefined {
  return expression && ts.isIdentifier(expression) ? (localInitializers.get(expression.text) ?? expression) : expression
}

/**
 * Converts a conservative subset of TypeScript expressions into JSON-compatible values.
 *
 * The supported subset is intentionally small: literals, arrays, object literals, and locally aliased
 * constants. Unsupported expressions return `undefined`, preserving the rule that extractors should
 * never infer facts from source they cannot represent safely.
 */
function expressionJson(expression: ts.Expression, localInitializers: ReadonlyMap<string, ts.Expression>): unknown {
  const resolved = resolveIdentifierExpression(expression, localInitializers)
  if (!resolved) return undefined
  expression = resolved
  if (ts.isStringLiteralLike(expression)) return expression.text
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isNumericLiteral(expression)) return Number(expression.text)
  if (ts.isArrayLiteralExpression(expression))
    return expression.elements.map((item) => expressionJson(item as ts.Expression, localInitializers))
  if (ts.isObjectLiteralExpression(expression)) {
    const entries = expression.properties.flatMap((item): Array<[string, unknown]> => {
      if (!ts.isPropertyAssignment(item)) return []
      const name = propertyName(item.name)
      return name ? [[name, expressionJson(item.initializer, localInitializers)]] : []
    })
    return Object.fromEntries(entries)
  }
  return undefined
}

/** Reads a simple function/property expression name without exposing the expression itself. */
function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

/** Type guard used after optional reader projections. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
