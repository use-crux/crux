import type { JsonSchema } from '@use-crux/core/project-index'
import type { SemanticAnalyzerNode, SemanticAnalyzerView } from '../candidates'
import { semanticNodeName, semanticPropertyName } from '../syntax-readers'

interface SchemaReferenceResolution {
  readonly key: string
  readonly expression: SemanticAnalyzerNode<SemanticAnalyzerView>
  readonly localInitializers: ReadonlyMap<string, SemanticAnalyzerNode<SemanticAnalyzerView>>
}

interface JsonSchemaProjectionOptions {
  readonly resolveIdentifier?: (identifier: SemanticAnalyzerNode<SemanticAnalyzerView>) => SchemaReferenceResolution | undefined
}

/** Builds a map of top-level variable initializers in a source file. */
export function semanticTopLevelInitializers(
  sourceFile: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): Map<string, SemanticAnalyzerNode<SemanticAnalyzerView>> {
  const initializers = new Map<string, SemanticAnalyzerNode<SemanticAnalyzerView>>()
  for (const statement of view.syntax.children(sourceFile)) {
    for (const declaration of view.syntax.variableStatementDeclarations(statement)) {
      const name = view.syntax.variableDeclarationName(declaration)
      const initializer = view.syntax.variableDeclarationInitializer(declaration)
      const key = name ? semanticNodeName(name, view.syntax) : undefined
      if (key && initializer) initializers.set(key, initializer)
    }
  }
  return initializers
}

/** Converts supported schema authoring expressions into Project Index JSON schema. */
export function semanticExpressionToJsonSchemaNode(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  localInitializers: ReadonlyMap<string, SemanticAnalyzerNode<SemanticAnalyzerView>>,
  view: SemanticAnalyzerView,
  options: JsonSchemaProjectionOptions = {},
): JsonSchema | undefined {
  return (
    zodExpressionToJsonSchema(expression, localInitializers, view, options) ??
    convexValidatorToJsonSchema(expression, localInitializers, view, options)
  )
}

function zodExpressionToJsonSchema(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  localInitializers: ReadonlyMap<string, SemanticAnalyzerNode<SemanticAnalyzerView>>,
  view: SemanticAnalyzerView,
  options: JsonSchemaProjectionOptions,
  seen = new Set<string>(),
): JsonSchema | undefined {
  const identifier = view.syntax.identifierText(expression)
  if (identifier) {
    const resolved = resolveSchemaIdentifier(identifier, expression, localInitializers, view, options, seen)
    return resolved ? zodExpressionToJsonSchema(resolved.expression, resolved.localInitializers, view, options, resolved.seen) : undefined
  }
  if (!view.syntax.isKind(expression, 'callExpression')) return undefined

  const call = schemaCall(expression, view, 'z')
  if (!call) return undefined
  const [firstArg] = view.syntax.callArguments(expression)

  if (call.method === 'object' && firstArg && view.syntax.isKind(firstArg, 'objectLiteral')) {
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const property of view.syntax.objectProperties(firstArg)) {
      const key = semanticPropertyName(property, view.syntax)
      const value = view.syntax.propertyInitializer(property)
      if (!key || !value) continue
      properties[key] = zodExpressionToJsonSchema(value, localInitializers, view, options, seen) ?? {}
      if (!isOptionalZodExpression(value, view)) required.push(key)
    }
    return { type: 'object', properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false }
  }

  if (call.method === 'array' && firstArg) {
    return { type: 'array', items: zodExpressionToJsonSchema(firstArg, localInitializers, view, options, seen) ?? {} }
  }

  if (call.method === 'enum' && firstArg && view.syntax.isKind(firstArg, 'arrayLiteral')) {
    const values = view.syntax.arrayElements(firstArg).flatMap((item) => {
      const value = view.syntax.stringLiteralText(item)
      return value === undefined ? [] : [value]
    })
    return { type: 'string', enum: values }
  }

  if (call.method === 'string') return { type: 'string' }
  if (call.method === 'number') return { type: 'number' }
  if (call.method === 'boolean') return { type: 'boolean' }
  if (call.method === 'literal' && firstArg) return { const: view.syntax.literalValue(firstArg) }

  const receiverSchema = call.receiver
    ? zodExpressionToJsonSchema(call.receiver, localInitializers, view, options, seen)
    : undefined
  if (!receiverSchema) return undefined

  switch (call.method) {
    case 'optional':
      return receiverSchema
    case 'describe': {
      const description = firstArg ? view.syntax.stringLiteralText(firstArg) : undefined
      return description === undefined ? receiverSchema : { ...receiverSchema, description }
    }
    case 'default':
      return { ...receiverSchema, default: firstArg ? view.syntax.literalValue(firstArg) : undefined }
    case 'max':
      return numericLimitSchema(receiverSchema, firstArg, view, 'max')
    case 'min':
      return numericLimitSchema(receiverSchema, firstArg, view, 'min')
    default:
      return receiverSchema
  }
}

function convexValidatorToJsonSchema(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  localInitializers: ReadonlyMap<string, SemanticAnalyzerNode<SemanticAnalyzerView>>,
  view: SemanticAnalyzerView,
  options: JsonSchemaProjectionOptions,
  seen = new Set<string>(),
): JsonSchema | undefined {
  const identifier = view.syntax.identifierText(expression)
  if (identifier) {
    const resolved = resolveSchemaIdentifier(identifier, expression, localInitializers, view, options, seen)
    return resolved
      ? convexValidatorToJsonSchema(resolved.expression, resolved.localInitializers, view, options, resolved.seen)
      : undefined
  }

  if (view.syntax.isKind(expression, 'objectLiteral')) {
    return objectLiteralSchema(expression, localInitializers, view, options, seen)
  }
  if (!view.syntax.isKind(expression, 'callExpression')) return undefined
  const call = schemaCall(expression, view, 'v')
  if (!call) return undefined
  const args = view.syntax.callArguments(expression)
  const [firstArg] = args

  if (call.method === 'optional' && firstArg) return convexValidatorToJsonSchema(firstArg, localInitializers, view, options, seen)
  if (call.method === 'string') return { type: 'string' }
  if (call.method === 'number' || call.method === 'float64') return { type: 'number' }
  if (call.method === 'int64') return { type: 'integer' }
  if (call.method === 'boolean') return { type: 'boolean' }
  if (call.method === 'null') return { type: 'null' }
  if (call.method === 'any') return {}
  if (call.method === 'id' && firstArg) {
    const table = view.syntax.stringLiteralText(firstArg)
    return table === undefined ? { type: 'string', format: 'convex-id' } : { type: 'string', format: 'convex-id', table }
  }
  if (call.method === 'literal') return { const: firstArg ? view.syntax.literalValue(firstArg) : undefined }
  if (call.method === 'array' && firstArg) {
    return { type: 'array', items: convexValidatorToJsonSchema(firstArg, localInitializers, view, options, seen) ?? {} }
  }
  if (call.method === 'object' && firstArg && view.syntax.isKind(firstArg, 'objectLiteral')) {
    return convexValidatorToJsonSchema(firstArg, localInitializers, view, options, seen)
  }
  if (call.method === 'union') {
    const variants = args
      .map((argument) => convexValidatorToJsonSchema(argument, localInitializers, view, options, seen))
      .filter((schema): schema is Record<string, unknown> => Boolean(schema))
    return variants.length > 0 ? { anyOf: variants } : undefined
  }
  if (call.method === 'record' && args.length >= 2) {
    return { type: 'object', additionalProperties: convexValidatorToJsonSchema(args[1]!, localInitializers, view, options, seen) ?? {} }
  }

  return undefined
}

function objectLiteralSchema(
  object: SemanticAnalyzerNode<SemanticAnalyzerView>,
  localInitializers: ReadonlyMap<string, SemanticAnalyzerNode<SemanticAnalyzerView>>,
  view: SemanticAnalyzerView,
  options: JsonSchemaProjectionOptions,
  seen: Set<string>,
): JsonSchema {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const property of view.syntax.objectProperties(object)) {
    const key = semanticPropertyName(property, view.syntax)
    const value = view.syntax.propertyInitializer(property)
    if (!key || !value) continue
    properties[key] = convexValidatorToJsonSchema(value, localInitializers, view, options, seen) ?? {}
    if (!isOptionalConvexValidator(value, view)) required.push(key)
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false }
}

function schemaCall(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
  rootReceiver: 'z' | 'v',
): { method: string; receiver?: SemanticAnalyzerNode<SemanticAnalyzerView> } | undefined {
  const target = view.syntax.callExpressionTarget(expression)
  if (!target || !view.syntax.isKind(target, 'propertyAccessExpression')) return undefined
  const method = view.syntax.propertyAccessName(target)
  const receiver = view.syntax.propertyAccessExpression(target)
  if (!method || !receiver) return undefined
  if (view.syntax.identifierText(receiver) === rootReceiver) return { method }
  return rootReceiver === 'z' ? { method, receiver } : undefined
}

function resolveSchemaIdentifier(
  identifier: string,
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  localInitializers: ReadonlyMap<string, SemanticAnalyzerNode<SemanticAnalyzerView>>,
  view: SemanticAnalyzerView,
  options: JsonSchemaProjectionOptions,
  seen: Set<string>,
):
  | {
      readonly expression: SemanticAnalyzerNode<SemanticAnalyzerView>
      readonly localInitializers: ReadonlyMap<string, SemanticAnalyzerNode<SemanticAnalyzerView>>
      readonly seen: Set<string>
    }
  | undefined {
  const localKey = `local:${identifier}`
  if (seen.has(localKey)) return undefined
  const target = localInitializers.get(identifier)
  if (target) return { expression: target, localInitializers, seen: new Set([...seen, localKey]) }
  const resolved = options.resolveIdentifier?.(expression)
  if (!resolved || seen.has(resolved.key)) return undefined
  return { expression: resolved.expression, localInitializers: resolved.localInitializers, seen: new Set([...seen, resolved.key]) }
}

function isOptionalZodExpression(expression: SemanticAnalyzerNode<SemanticAnalyzerView>, view: SemanticAnalyzerView): boolean {
  return view.syntax.isKind(expression, 'callExpression') && schemaCall(expression, view, 'z')?.method === 'optional'
}

function isOptionalConvexValidator(
  expression: SemanticAnalyzerNode<SemanticAnalyzerView>,
  view: SemanticAnalyzerView,
): boolean {
  return view.syntax.isKind(expression, 'callExpression') && schemaCall(expression, view, 'v')?.method === 'optional'
}

function numericLimitSchema(
  schema: JsonSchema,
  firstArg: SemanticAnalyzerNode<SemanticAnalyzerView> | undefined,
  view: SemanticAnalyzerView,
  mode: 'min' | 'max',
): JsonSchema {
  const value = firstArg ? view.syntax.literalValue(firstArg) : undefined
  if (typeof value !== 'number') return schema
  if (schema.type === 'array') return { ...schema, [mode === 'min' ? 'minItems' : 'maxItems']: value }
  return { ...schema, [mode === 'min' ? 'minLength' : 'maxLength']: value }
}
