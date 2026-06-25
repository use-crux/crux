import type { StaticInitializerRecord, StaticObjectValue, StaticSyntaxValue } from './types'

/** Local initializer lookup used by record-backed extractor readers. */
export type StaticSyntaxInitializerMap = ReadonlyMap<string, StaticSyntaxValue>

/**
 * Builds an immutable lookup for source-local initializer records.
 *
 * Initializers are syntax evidence, not evaluated runtime values. The map exists only so readers can
 * follow simple local aliases in the same conservative way as the TypeScript-backed parser reader.
 */
export function createStaticSyntaxInitializerMap(
  records: readonly StaticInitializerRecord[],
): StaticSyntaxInitializerMap {
  return new Map(records.map((record) => [record.name, record.value]))
}

/** Resolves one identifier chain through source-local initializer records. */
export function resolveStaticSyntaxValue(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): StaticSyntaxValue | undefined {
  return resolveStaticSyntaxValueWithSeen(value, initializers, new Set())
}

/** Locates a named object property without following aliases. */
export function staticObjectPropertyValue(
  object: StaticObjectValue,
  property: string,
): StaticSyntaxValue | undefined {
  return object.properties.find((item) => !item.spread && item.name === property)?.value
}

/** Returns a literal string from a syntax value after optional alias resolution. */
export function staticStringValue(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): string | undefined {
  const resolved = resolveStaticSyntaxValue(value, initializers)
  return resolved?.kind === 'literal' && typeof resolved.value === 'string' ? resolved.value : undefined
}

/** Returns a literal number from a syntax value after optional alias resolution. */
export function staticNumberValue(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): number | undefined {
  const resolved = resolveStaticSyntaxValue(value, initializers)
  return resolved?.kind === 'literal' && typeof resolved.value === 'number' ? resolved.value : undefined
}

/** Returns a literal boolean from a syntax value after optional alias resolution. */
export function staticBooleanValue(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): boolean | undefined {
  const resolved = resolveStaticSyntaxValue(value, initializers)
  return resolved?.kind === 'literal' && typeof resolved.value === 'boolean' ? resolved.value : undefined
}

/** Returns an object value after optional alias resolution. */
export function staticObjectValue(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): StaticObjectValue | undefined {
  const resolved = resolveStaticSyntaxValue(value, initializers)
  return resolved?.kind === 'object' ? resolved : undefined
}

/** Returns the authored reference name for identifier and property-access values. */
export function staticReferenceName(value: StaticSyntaxValue | undefined): string | undefined {
  if (!value) return undefined
  if (value.kind === 'identifier' || value.kind === 'property-access') return value.name
  return undefined
}

/** Converts conservative syntax values into JSON-compatible data. */
export function staticSyntaxValueJson(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): unknown {
  const resolved = resolveStaticSyntaxValue(value, initializers)
  if (!resolved) return undefined
  switch (resolved.kind) {
    case 'literal':
      return resolved.value
    case 'array':
      return resolved.elements.map((element) => staticSyntaxValueJson(element, initializers))
    case 'object':
      return Object.fromEntries(
        resolved.properties
          .filter((property) => !property.spread)
          .map((property) => [property.name, staticSyntaxValueJson(property.value, initializers)]),
      )
    case 'identifier':
    case 'property-access':
    case 'call':
    case 'template':
    case 'function':
    case 'unsupported':
      return undefined
    default:
      return assertNever(resolved)
  }
}

function resolveStaticSyntaxValueWithSeen(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
  seen: Set<string>,
): StaticSyntaxValue | undefined {
  if (!value || value.kind !== 'identifier') return value
  if (seen.has(value.name)) return value
  seen.add(value.name)
  return resolveStaticSyntaxValueWithSeen(initializers.get(value.name) ?? value, initializers, seen)
}

function assertNever(value: never): never {
  throw new Error(`Unhandled static syntax value: ${JSON.stringify(value)}`)
}
