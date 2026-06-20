import type { JsonSchema } from '@crux/core/project-index'
import {
  isArrayLiteralExpression,
  isCallExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isStringLiteral,
  type Expression,
  type ObjectLiteralExpression,
  type PropertyAssignment,
  type SourceFile,
} from '@typescript/native-preview/unstable/ast'
import { nativeNodeList } from './tsgo-native-source'

interface NativeSchemaResult {
  readonly schema: JsonSchema
  readonly optional: boolean
}

export function nativeZodExpressionToJsonSchema(
  sourceFile: SourceFile,
  expression: Expression,
  resolveIdentifier: (name: string) => Expression | undefined,
): JsonSchema | undefined {
  return zodSchemaResult(sourceFile, expression, resolveIdentifier)?.schema
}

function zodSchemaResult(
  sourceFile: SourceFile,
  expression: Expression,
  resolveIdentifier: (name: string) => Expression | undefined,
): NativeSchemaResult | undefined {
  if (isIdentifier(expression)) {
    const resolved = resolveIdentifier(expression.text)
    return resolved ? zodSchemaResult(sourceFile, resolved, resolveIdentifier) : undefined
  }
  if (!isCallExpression(expression)) return undefined

  const call = zodCallName(expression)
  if (!call) return undefined
  if (call.property === 'optional') {
    const inner = zodSchemaResult(sourceFile, call.receiver, resolveIdentifier)
    return inner ? { schema: inner.schema, optional: true } : undefined
  }

  switch (call.property) {
    case 'string':
      return { schema: { type: 'string' }, optional: false }
    case 'number':
      return { schema: { type: 'number' }, optional: false }
    case 'boolean':
      return { schema: { type: 'boolean' }, optional: false }
    case 'array':
      return zodArraySchema(sourceFile, expression, resolveIdentifier)
    case 'enum':
      return zodEnumSchema(expression)
    case 'object':
      return zodObjectSchema(sourceFile, expression, resolveIdentifier)
    default:
      return undefined
  }
}

function zodArraySchema(
  sourceFile: SourceFile,
  expression: Expression,
  resolveIdentifier: (name: string) => Expression | undefined,
): NativeSchemaResult | undefined {
  if (!isCallExpression(expression)) return undefined
  const [item] = nativeNodeList(expression.arguments)
  if (!item) return undefined
  const itemSchema = zodSchemaResult(sourceFile, item, resolveIdentifier)
  return itemSchema ? { schema: { type: 'array', items: itemSchema.schema }, optional: false } : undefined
}

function zodEnumSchema(expression: Expression): NativeSchemaResult | undefined {
  if (!isCallExpression(expression)) return undefined
  const [values] = nativeNodeList(expression.arguments)
  if (!values || !isArrayLiteralExpression(values)) return undefined
  const elements = nativeNodeList(values.elements)
  const enumValues = elements.flatMap((element) => (isStringLiteral(element) ? [element.text] : []))
  return enumValues.length === elements.length
    ? { schema: { type: 'string', enum: enumValues }, optional: false }
    : undefined
}

function zodObjectSchema(
  sourceFile: SourceFile,
  expression: Expression,
  resolveIdentifier: (name: string) => Expression | undefined,
): NativeSchemaResult | undefined {
  if (!isCallExpression(expression)) return undefined
  const [shape] = nativeNodeList(expression.arguments)
  if (!shape || !isObjectLiteralExpression(shape)) return undefined
  return zodObjectLiteralSchema(sourceFile, shape, resolveIdentifier)
}

function zodObjectLiteralSchema(
  sourceFile: SourceFile,
  object: ObjectLiteralExpression,
  resolveIdentifier: (name: string) => Expression | undefined,
): NativeSchemaResult | undefined {
  const entries = nativeNodeList(object.properties).map((property) =>
    isPropertyAssignment(property) ? zodObjectProperty(sourceFile, property, resolveIdentifier) : undefined,
  )
  if (entries.some((entry) => !entry)) return undefined

  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const entry of entries) {
    if (!entry) return undefined
    properties[entry.name] = entry.schema
    if (!entry.optional) required.push(entry.name)
  }

  return {
    schema: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
    },
    optional: false,
  }
}

function zodObjectProperty(
  sourceFile: SourceFile,
  property: PropertyAssignment,
  resolveIdentifier: (name: string) => Expression | undefined,
): { readonly name: string; readonly schema: JsonSchema; readonly optional: boolean } | undefined {
  const name = propertyNameText(property.name)
  const result = zodSchemaResult(sourceFile, property.initializer, resolveIdentifier)
  return name && result ? { name, schema: result.schema, optional: result.optional } : undefined
}

function zodCallName(expression: Expression): { readonly receiver: Expression; readonly property: string } | undefined {
  if (!isCallExpression(expression) || !isPropertyAccessExpression(expression.expression)) return undefined
  const access = expression.expression
  return { receiver: access.expression, property: access.name.text }
}

function propertyNameText(name: PropertyAssignment['name']): string | undefined {
  if (isIdentifier(name) || isStringLiteral(name)) return name.text
  return undefined
}
