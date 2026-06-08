import ts from 'typescript'
import { literalValue, numericLiteralValue, propertyName } from './literals'

export interface SchemaReferenceResolution {
  readonly key: string
  readonly expression: ts.Expression
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
}

export interface JsonSchemaProjectionOptions {
  readonly resolveIdentifier?: (identifier: ts.Identifier) => SchemaReferenceResolution | undefined
}

export function schemaProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
  options?: JsonSchemaProjectionOptions,
): Record<string, unknown> | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name)
  if (!property) return undefined
  return expressionToJsonSchema(property.initializer, localInitializers, options)
}

export function expressionToJsonSchema(
  expression: ts.Expression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
  options?: JsonSchemaProjectionOptions,
): Record<string, unknown> | undefined {
  return (
    zodExpressionToJsonSchema(expression, localInitializers, options) ??
    convexValidatorToJsonSchema(expression, localInitializers, options)
  )
}

export function zodExpressionToJsonSchema(
  expression: ts.Expression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
  options?: JsonSchemaProjectionOptions,
  seen = new Set<string>(),
): Record<string, unknown> | undefined {
  if (ts.isIdentifier(expression)) {
    const localKey = `local:${expression.text}`
    if (seen.has(localKey)) return undefined
    const target = localInitializers.get(expression.text)
    if (target) {
      const nextSeen = new Set(seen)
      nextSeen.add(localKey)
      return zodExpressionToJsonSchema(target, localInitializers, options, nextSeen)
    }
    const resolved = options?.resolveIdentifier?.(expression)
    if (!resolved || seen.has(resolved.key)) return undefined
    const nextSeen = new Set(seen)
    nextSeen.add(resolved.key)
    return zodExpressionToJsonSchema(resolved.expression, resolved.localInitializers, options, nextSeen)
  }
  if (!ts.isCallExpression(expression)) return undefined

  const call = zodCall(expression)
  if (!call) return undefined
  const [firstArg] = expression.arguments

  if (call.method === 'object' && firstArg && ts.isObjectLiteralExpression(firstArg)) {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const property of firstArg.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const key = propertyName(property.name)
      if (!key) continue
      const child = zodExpressionToJsonSchema(property.initializer, localInitializers, options, seen) ?? {}
      properties[key] = child
      if (!isOptionalZodExpression(property.initializer)) required.push(key)
    }
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    }
  }

  if (call.method === 'array' && firstArg) {
    return { type: 'array', items: zodExpressionToJsonSchema(firstArg, localInitializers, options, seen) ?? {} }
  }

  if (call.method === 'enum' && firstArg && ts.isArrayLiteralExpression(firstArg)) {
    const values = firstArg.elements
      .filter((item): item is ts.StringLiteral => ts.isStringLiteral(item))
      .map((item) => item.text)
    return { type: 'string', enum: values }
  }

  if (call.method === 'string') return { type: 'string' }
  if (call.method === 'number') return { type: 'number' }
  if (call.method === 'boolean') return { type: 'boolean' }
  if (call.method === 'literal' && firstArg && ts.isStringLiteralLike(firstArg)) return { const: firstArg.text }
  if (call.method === 'literal' && firstArg && ts.isNumericLiteral(firstArg)) return { const: Number(firstArg.text) }

  const receiverSchema = call.receiver ? zodExpressionToJsonSchema(call.receiver, localInitializers, options, seen) : undefined
  if (!receiverSchema) return undefined

  switch (call.method) {
    case 'optional':
      return receiverSchema
    case 'describe':
      if (firstArg && ts.isStringLiteralLike(firstArg)) return { ...receiverSchema, description: firstArg.text }
      return receiverSchema
    case 'default':
      return { ...receiverSchema, default: literalValue(firstArg) }
    case 'max': {
      const max = numericLiteralValue(firstArg)
      if (max === undefined) return receiverSchema
      return receiverSchema.type === 'array' ? { ...receiverSchema, maxItems: max } : { ...receiverSchema, maxLength: max }
    }
    case 'min': {
      const min = numericLiteralValue(firstArg)
      if (min === undefined) return receiverSchema
      return receiverSchema.type === 'array' ? { ...receiverSchema, minItems: min } : { ...receiverSchema, minLength: min }
    }
    default:
      return receiverSchema
  }
}

function zodCall(expression: ts.CallExpression): { method: string; receiver?: ts.Expression } | undefined {
  if (ts.isPropertyAccessExpression(expression.expression)) {
    const method = expression.expression.name.text
    const receiver = expression.expression.expression
    if (ts.isIdentifier(receiver) && receiver.text === 'z') return { method }
    return { method, receiver }
  }
  return undefined
}

function isOptionalZodExpression(expression: ts.Expression): boolean {
  if (!ts.isCallExpression(expression)) return false
  const call = zodCall(expression)
  return call?.method === 'optional'
}

export function convexValidatorToJsonSchema(
  expression: ts.Expression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
  options?: JsonSchemaProjectionOptions,
  seen = new Set<string>(),
): Record<string, unknown> | undefined {
  if (ts.isIdentifier(expression)) {
    const localKey = `local:${expression.text}`
    if (seen.has(localKey)) return undefined
    const target = localInitializers.get(expression.text)
    if (target) {
      const nextSeen = new Set(seen)
      nextSeen.add(localKey)
      return convexValidatorToJsonSchema(target, localInitializers, options, nextSeen)
    }
    const resolved = options?.resolveIdentifier?.(expression)
    if (!resolved || seen.has(resolved.key)) return undefined
    const nextSeen = new Set(seen)
    nextSeen.add(resolved.key)
    return convexValidatorToJsonSchema(resolved.expression, resolved.localInitializers, options, nextSeen)
  }

  if (ts.isObjectLiteralExpression(expression)) {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) continue
      const key = propertyName(property.name)
      if (!key) continue
      properties[key] = convexValidatorToJsonSchema(property.initializer, localInitializers, options, seen) ?? {}
      if (!isOptionalConvexValidator(property.initializer)) required.push(key)
    }
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    }
  }

  if (!ts.isCallExpression(expression)) return undefined
  const call = convexValidatorCall(expression)
  if (!call) return undefined
  const [firstArg] = expression.arguments

  if (call.method === 'optional' && firstArg) return convexValidatorToJsonSchema(firstArg, localInitializers, options, seen)
  if (call.method === 'string') return { type: 'string' }
  if (call.method === 'number' || call.method === 'float64') return { type: 'number' }
  if (call.method === 'int64') return { type: 'integer' }
  if (call.method === 'boolean') return { type: 'boolean' }
  if (call.method === 'null') return { type: 'null' }
  if (call.method === 'any') return {}
  if (call.method === 'id' && firstArg && ts.isStringLiteralLike(firstArg)) {
    return { type: 'string', format: 'convex-id', table: firstArg.text }
  }
  if (call.method === 'literal') {
    return { const: literalValue(firstArg) }
  }
  if (call.method === 'array' && firstArg) {
    return { type: 'array', items: convexValidatorToJsonSchema(firstArg, localInitializers, options, seen) ?? {} }
  }
  if (call.method === 'object' && firstArg && ts.isObjectLiteralExpression(firstArg)) {
    return convexValidatorToJsonSchema(firstArg, localInitializers, options, seen)
  }
  if (call.method === 'union') {
    const variants = expression.arguments
      .map((argument) => convexValidatorToJsonSchema(argument, localInitializers, options, seen))
      .filter((schema): schema is Record<string, unknown> => Boolean(schema))
    return variants.length > 0 ? { anyOf: variants } : undefined
  }
  if (call.method === 'record' && expression.arguments.length >= 2) {
    const value = convexValidatorToJsonSchema(expression.arguments[1], localInitializers, options, seen) ?? {}
    return { type: 'object', additionalProperties: value }
  }

  return undefined
}

function convexValidatorCall(expression: ts.CallExpression): { method: string } | undefined {
  if (!ts.isPropertyAccessExpression(expression.expression)) return undefined
  const receiver = expression.expression.expression
  if (!ts.isIdentifier(receiver) || receiver.text !== 'v') return undefined
  return { method: expression.expression.name.text }
}

function isOptionalConvexValidator(expression: ts.Expression): boolean {
  if (!ts.isCallExpression(expression)) return false
  const call = convexValidatorCall(expression)
  return call?.method === 'optional'
}
