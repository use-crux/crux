import type { StaticArgumentReader, StaticCallObjectReader, StaticObjectReader } from '../../extensions/types'
import type { StaticObjectValue, StaticSyntaxValue } from './types'
import {
  resolveStaticSyntaxValue,
  staticBooleanValue,
  staticNumberValue,
  staticObjectPropertyValue,
  staticObjectValue,
  staticReferenceName,
  staticStringValue,
  staticSyntaxValueJson,
  type StaticSyntaxInitializerMap,
} from './value'
import { staticRecordSchemaProperty } from './schema'

/** Creates the stable positional argument reader from syntax-record values. */
export function createStaticRecordArgumentReader(
  args: readonly StaticSyntaxValue[],
  initializers: StaticSyntaxInitializerMap,
): StaticArgumentReader {
  return {
    string: (index) => staticStringValue(args[index], initializers),
    identifier: (index) => identifierValue(args[index], initializers),
    object: (index) => {
      const object = staticObjectValue(args[index], initializers)
      return object ? createStaticRecordObjectReader(object, initializers) : undefined
    },
    objectArray: (index) => objectArrayValue(args[index], initializers).map((item) =>
      createStaticRecordObjectReader(item, initializers),
    ),
    json: (index) => staticSyntaxValueJson(args[index], initializers),
  }
}

/** Creates the stable object/config reader from a syntax-record object value. */
export function createStaticRecordObjectReader(
  object: StaticObjectValue,
  initializers: StaticSyntaxInitializerMap,
): StaticObjectReader {
  const properties = staticObjectPropertyMap(object)
  const propertyValue = (property: string): StaticSyntaxValue | undefined => properties.get(property)
  return {
    has: (property) => properties.has(property),
    string: (property) => {
      const value = propertyValue(property)
      return value?.kind === 'literal' && typeof value.value === 'string' ? value.value : undefined
    },
    number: (property) => staticNumberValue(propertyValue(property), initializers),
    boolean: (property) => staticBooleanValue(propertyValue(property), initializers),
    stringArray: (property) => stringArrayValue(propertyValue(property)),
    identifier: (property) => directIdentifier(propertyValue(property)),
    reference: (property) => referenceValue(propertyValue(property), initializers),
    identifierArray: (property) => identifierArrayValue(propertyValue(property), initializers),
    object: (property) => {
      const nested = staticObjectValue(propertyValue(property), initializers)
      return nested ? createStaticRecordObjectReader(nested, initializers) : undefined
    },
    objectArray: (property) => objectArrayValue(propertyValue(property), initializers).map((item) =>
      createStaticRecordObjectReader(item, initializers),
    ),
    callObject: (property) => callObjectValue(propertyValue(property), initializers),
    callObjectArray: (property) => callObjectArrayValue(propertyValue(property), initializers),
    nestedString: (path) => nestedStringValue(object, path, initializers),
    objectMapIdentifiers: (property) => objectMapIdentifierValues(propertyValue(property), initializers),
    objectMapIdentifierEntries: (property) =>
      objectMapIdentifierEntries(propertyValue(property), initializers),
    schema: (property) => staticRecordSchemaProperty(object, property, initializers),
    json: (property) =>
      staticSyntaxValueJson(property === undefined ? object : propertyValue(property), initializers),
  }
}

function staticObjectPropertyMap(object: StaticObjectValue): ReadonlyMap<string, StaticSyntaxValue> {
  const properties = new Map<string, StaticSyntaxValue>()
  for (const property of object.properties) {
    if (property.spread || properties.has(property.name)) continue
    properties.set(property.name, property.value)
  }
  return properties
}

function identifierValue(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): string | undefined {
  return directIdentifier(value) ?? directIdentifier(resolveStaticSyntaxValue(value, initializers))
}

function directIdentifier(value: StaticSyntaxValue | undefined): string | undefined {
  return value?.kind === 'identifier' ? value.name : undefined
}

function referenceValue(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): string | undefined {
  return staticReferenceName(value) ?? staticReferenceName(resolveStaticSyntaxValue(value, initializers))
}

function stringArrayValue(value: StaticSyntaxValue | undefined): readonly string[] {
  if (value?.kind !== 'array') return []
  return value.elements.flatMap((element) =>
    element.kind === 'literal' && typeof element.value === 'string' ? [element.value] : [],
  )
}

function identifierArrayValue(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): readonly string[] {
  const resolved = resolveStaticSyntaxValue(value, initializers)
  if (resolved?.kind !== 'array') return []
  return resolved.elements.flatMap((element) => (element.kind === 'identifier' ? [element.name] : []))
}

function objectArrayValue(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): readonly StaticObjectValue[] {
  const resolved = resolveStaticSyntaxValue(value, initializers)
  if (resolved?.kind !== 'array') return []
  return resolved.elements.flatMap((element) => {
    const object = staticObjectValue(element, initializers)
    return object ? [object] : []
  })
}

function callObjectValue(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): StaticCallObjectReader | undefined {
  const resolved = resolveStaticSyntaxValue(value, initializers)
  if (resolved?.kind !== 'call') return undefined
  const config = staticObjectValue(resolved.args[0], initializers)
  return config
    ? {
        name: resolved.callee.localName ?? resolved.callee.name,
        config: createStaticRecordObjectReader(config, initializers),
      }
    : undefined
}

function callObjectArrayValue(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): readonly StaticCallObjectReader[] {
  const resolved = resolveStaticSyntaxValue(value, initializers)
  if (resolved?.kind !== 'array') return []
  return resolved.elements.flatMap((element) => {
    const call = callObjectValue(element, initializers)
    return call ? [call] : []
  })
}

function nestedStringValue(
  object: StaticObjectValue,
  path: readonly string[],
  initializers: StaticSyntaxInitializerMap,
): string | undefined {
  const value = path.reduce<StaticSyntaxValue | undefined>((current, segment) => {
    const nested = staticObjectValue(current, initializers)
    return nested ? staticObjectPropertyValue(nested, segment) : undefined
  }, object)
  return staticStringValue(value, initializers)
}

function objectMapIdentifierValues(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): readonly string[] {
  return objectMapIdentifierEntries(value, initializers).map((entry) => entry.value)
}

function objectMapIdentifierEntries(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): readonly { readonly key: string; readonly value: string }[] {
  const object = staticObjectValue(value, initializers)
  if (!object) return []
  return object.properties.flatMap((property) => {
    if (property.spread) return []
    const name = directIdentifier(property.value)
    return name ? [{ key: property.name, value: name }] : []
  })
}
