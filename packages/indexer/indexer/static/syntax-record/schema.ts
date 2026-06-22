import type { JsonSchema } from '@crux/core/project-index'
import type { StaticObjectValue, StaticSyntaxValue } from './types'
import {
  resolveStaticSyntaxValue,
  staticObjectPropertyValue,
  type StaticSyntaxInitializerMap,
} from './value'

/** Projects a record-backed object property into JSON Schema when it matches a known schema DSL. */
export function staticRecordSchemaProperty(
  object: StaticObjectValue,
  property: string,
  initializers: StaticSyntaxInitializerMap,
): JsonSchema | undefined {
  return staticSyntaxValueToJsonSchema(staticObjectPropertyValue(object, property), initializers)
}

/** Projects a conservative subset of record-backed Zod and Convex validator values into JSON Schema. */
export function staticSyntaxValueToJsonSchema(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): JsonSchema | undefined {
  return (
    zodValueToJsonSchema(value, initializers, new Set()) ??
    convexValidatorToJsonSchema(value, initializers, new Set())
  )
}

function zodValueToJsonSchema(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
  seen: Set<string>,
): JsonSchema | undefined {
  if (value?.kind === 'identifier') {
    if (seen.has(`local:${value.name}`)) return undefined
    const resolved = initializers.get(value.name)
    if (!resolved) return undefined
    return zodValueToJsonSchema(resolved, initializers, seenWith(seen, `local:${value.name}`))
  }
  const expression = resolveStaticSyntaxValue(value, initializers)
  if (expression?.kind !== 'call') return undefined

  const method = expression.callee.name
  const [firstArg] = expression.args
  const receiverSchema = expression.receiver
    ? zodValueToJsonSchema(expression.receiver, initializers, seen)
    : undefined
  const isZodRoot = isRootNamespace(expression.receiver, 'z')

  if (method === 'object' && isZodRoot && firstArg?.kind === 'object') return zodObjectSchema(firstArg, initializers, seen)
  if (method === 'array' && isZodRoot && firstArg) {
    return { type: 'array', items: zodValueToJsonSchema(firstArg, initializers, seen) ?? {} }
  }
  if (method === 'enum' && isZodRoot && firstArg?.kind === 'array') {
    return {
      type: 'string',
      enum: firstArg.elements.flatMap((item) =>
        item.kind === 'literal' && typeof item.value === 'string' ? [item.value] : [],
      ),
    }
  }
  if (method === 'string' && isZodRoot) return { type: 'string' }
  if (method === 'number' && isZodRoot) return { type: 'number' }
  if (method === 'boolean' && isZodRoot) return { type: 'boolean' }
  if (method === 'literal' && isZodRoot && firstArg?.kind === 'literal') return { const: firstArg.value }

  if (!receiverSchema) return undefined
  switch (method) {
    case 'optional':
      return receiverSchema
    case 'describe':
      return firstArg?.kind === 'literal' && typeof firstArg.value === 'string'
        ? { ...receiverSchema, description: firstArg.value }
        : receiverSchema
    case 'default':
      return { ...receiverSchema, default: firstArg?.kind === 'literal' ? firstArg.value : undefined }
    case 'max':
      return numericZodBound(receiverSchema, firstArg, 'max')
    case 'min':
      return numericZodBound(receiverSchema, firstArg, 'min')
    default:
      return receiverSchema
  }
}

function zodObjectSchema(
  object: StaticObjectValue,
  initializers: StaticSyntaxInitializerMap,
  seen: Set<string>,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const property of object.properties) {
    if (property.spread) continue
    properties[property.name] = zodValueToJsonSchema(property.value, initializers, seen) ?? {}
    if (!isOptionalZodValue(property.value)) required.push(property.name)
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

function convexValidatorToJsonSchema(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
  seen: Set<string>,
): JsonSchema | undefined {
  if (value?.kind === 'identifier') {
    if (seen.has(`local:${value.name}`)) return undefined
    const resolved = initializers.get(value.name)
    if (!resolved) return undefined
    return convexValidatorToJsonSchema(resolved, initializers, seenWith(seen, `local:${value.name}`))
  }
  const expression = resolveStaticSyntaxValue(value, initializers)
  if (expression?.kind === 'object') return convexObjectSchema(expression, initializers, seen)
  if (expression?.kind !== 'call' || !isRootNamespace(expression.receiver, 'v')) return undefined

  const method = expression.callee.name
  const [firstArg] = expression.args
  if (method === 'optional' && firstArg) return convexValidatorToJsonSchema(firstArg, initializers, seen)
  if (method === 'string') return { type: 'string' }
  if (method === 'number' || method === 'float64') return { type: 'number' }
  if (method === 'int64') return { type: 'integer' }
  if (method === 'boolean') return { type: 'boolean' }
  if (method === 'null') return { type: 'null' }
  if (method === 'any') return {}
  if (method === 'id' && firstArg?.kind === 'literal' && typeof firstArg.value === 'string') {
    return { type: 'string', format: 'convex-id', table: firstArg.value }
  }
  if (method === 'literal' && firstArg?.kind === 'literal') return { const: firstArg.value }
  if (method === 'array' && firstArg) {
    return { type: 'array', items: convexValidatorToJsonSchema(firstArg, initializers, seen) ?? {} }
  }
  if (method === 'object' && firstArg?.kind === 'object') return convexObjectSchema(firstArg, initializers, seen)
  if (method === 'union') {
    const anyOf = expression.args
      .map((argument) => convexValidatorToJsonSchema(argument, initializers, seen))
      .filter((schema): schema is JsonSchema => Boolean(schema))
    return anyOf.length > 0 ? { anyOf } : undefined
  }
  if (method === 'record' && expression.args.length >= 2) {
    return {
      type: 'object',
      additionalProperties: convexValidatorToJsonSchema(expression.args[1], initializers, seen) ?? {},
    }
  }
  return undefined
}

function convexObjectSchema(
  object: StaticObjectValue,
  initializers: StaticSyntaxInitializerMap,
  seen: Set<string>,
): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const property of object.properties) {
    if (property.spread) continue
    properties[property.name] = convexValidatorToJsonSchema(property.value, initializers, seen) ?? {}
    if (!isOptionalConvexValue(property.value)) required.push(property.name)
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

function numericZodBound(schema: JsonSchema, arg: StaticSyntaxValue | undefined, bound: 'min' | 'max'): JsonSchema {
  const value = arg?.kind === 'literal' && typeof arg.value === 'number' ? arg.value : undefined
  if (value === undefined) return schema
  if (schema.type === 'array') return { ...schema, [bound === 'min' ? 'minItems' : 'maxItems']: value }
  return { ...schema, [bound === 'min' ? 'minLength' : 'maxLength']: value }
}

function isOptionalZodValue(value: StaticSyntaxValue): boolean {
  return value.kind === 'call' && value.callee.name === 'optional'
}

function isOptionalConvexValue(value: StaticSyntaxValue): boolean {
  return value.kind === 'call' && value.callee.name === 'optional' && isRootNamespace(value.receiver, 'v')
}

function isRootNamespace(value: StaticSyntaxValue | undefined, namespace: 'z' | 'v'): boolean {
  return (
    (value?.kind === 'identifier' && value.name === namespace) ||
    (value?.kind === 'property-access' && value.path[0] === namespace)
  )
}

function seenWith(seen: Set<string>, key: string): Set<string> {
  const next = new Set(seen)
  next.add(key)
  return next
}
