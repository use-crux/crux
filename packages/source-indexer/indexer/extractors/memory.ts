import ts from 'typescript'
import { hasProperty, nestedStringProperty, numberProperty, propertyName, stringProperty } from '../ast/literals'
import { schemaProperty } from '../ast/schemas'
import { foldedCatalogChild } from '../catalog-presentation'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'

export const memoryExtractor: PrimitiveExtractor = {
  name: 'memory',
  capabilities: ['definition', 'relation', 'schema', 'source', 'runtime-join', 'partial'],
  callNames: ['memory'],
  extract: (ctx) => {
    if (ctx.callName !== 'memory' || !ctx.objectArg) return undefined
    const idInfo = authoredMemoryId(ctx.objectArg, ctx.localInitializers)
    const definitionKey = idInfo.definitionKey ?? ctx.localName
    const id = `memory:${ctx.safeId(idInfo.definitionKey ?? ctx.localName)}`
    const blocks = memoryBlockMetadata(ctx.objectArg, ctx.localInitializers)
    const store = authoredStoreDefinition(ctx, definitionKey, id, 'memory.uses_store', ctx.objectArg)
    const blockDefinitions = blocks.map((block, index) =>
      ctx.define(`memory.block:${ctx.safeId(idInfo.definitionKey ?? ctx.localName)}:${ctx.safeId(block.id ?? block.kind ?? 'block')}`, 'memory.block', block.id ?? block.kind ?? 'block', block.objectArg, {
        exportName: ctx.variableName,
        memoryId: id,
        blockId: block.id,
        blockKind: block.kind,
        catalogPresentation: foldedCatalogChild({
          parentDefinitionId: id,
          parentRelationType: 'memory.includes_block',
          role: 'block',
          order: index,
        }),
        priority: block.priority,
        schema: block.schema,
        writeMode: block.writeMode,
        hasEmbed: block.hasEmbed,
      }),
    )
    const extraDefinitions = [...blockDefinitions, ...(store ? [store.definition] : [])]
    const relationRefs = [
      ...blockDefinitions.map((definition) => ({ type: 'memory.includes_block', toId: definition.id })),
      ...(store ? [{ type: 'memory.uses_store', toId: store.definition.id }] : []),
    ]
    return foundDefinition(
      ctx.variableName,
      ctx.define(id, 'memory', idInfo.displayName ?? ctx.variableName, ctx.objectArg, {
        exportName: ctx.variableName,
        runtimeIdPrefix: idInfo.runtimeIdPrefix,
        ...staticMemoryMetadata(blocks, ctx.objectArg, ctx.localInitializers),
      }),
      relationRefs,
      extraDefinitions,
    )
  },
}

export const blackboardExtractor: PrimitiveExtractor = {
  name: 'blackboard',
  capabilities: ['definition', 'schema', 'source', 'runtime-join', 'partial'],
  callNames: ['blackboard'],
  extract: (ctx) => {
    if (ctx.callName !== 'blackboard' || !ctx.objectArg) return undefined
    const idInfo = authoredMemoryId(ctx.objectArg, ctx.localInitializers)
    const definitionKey = idInfo.definitionKey ?? ctx.localName
    const id = `blackboard:${ctx.safeId(idInfo.definitionKey ?? ctx.localName)}`
    const store = authoredStoreDefinition(ctx, definitionKey, id, 'blackboard.uses_store', ctx.objectArg)
    return foundDefinition(
      ctx.variableName,
      ctx.define(id, 'blackboard', idInfo.displayName ?? ctx.variableName, ctx.objectArg, {
        exportName: ctx.variableName,
        schema: schemaProperty(ctx.objectArg, 'schema', ctx.localInitializers),
        backend: authoredStoreName(ctx.objectArg, ctx.localInitializers),
        conflictPolicy: stringProperty(ctx.objectArg, 'conflictPolicy'),
        runtimeIdPrefix: idInfo.runtimeIdPrefix,
      }),
      store ? [{ type: 'blackboard.uses_store', toId: store.definition.id }] : [],
      store ? [store.definition] : undefined,
    )
  },
}

function authoredMemoryId(
  object: ts.ObjectLiteralExpression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): { definitionKey?: string; displayName?: string; runtimeIdPrefix?: string } {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === 'id')
  if (!property) return {}
  const initializer = resolveIdentifierExpression(property.initializer, localInitializers)
  if (ts.isStringLiteralLike(initializer)) {
    return { definitionKey: initializer.text, displayName: initializer.text }
  }
  const prefix = createMemoryIdPrefix(initializer)
  if (prefix) {
    const key = prefix.endsWith(':') ? prefix.slice(0, -1) : prefix
    return { definitionKey: key, displayName: `${prefix}*`, runtimeIdPrefix: prefix }
  }
  if (ts.isIdentifier(property.initializer)) {
    return { definitionKey: property.initializer.text, displayName: property.initializer.text }
  }
  return {}
}

function createMemoryIdPrefix(expression: ts.Expression): string | undefined {
  if (!ts.isCallExpression(expression) || expressionName(expression.expression) !== 'createMemoryId') return undefined
  const [typeArg] = expression.arguments
  if (!typeArg || !ts.isStringLiteralLike(typeArg)) return undefined
  const prefix = memoryIdPrefixForType(typeArg.text)
  return prefix ? `${prefix}:` : undefined
}

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

function staticMemoryMetadata(
  blocks: readonly MemoryBlockMetadata[],
  object: ts.ObjectLiteralExpression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): Record<string, unknown> {
  const workingSchemas = blocks.filter((block) => block.kind === 'working' && block.schema)
  const defaultSchemas = blocks.map((block) => block.schema ?? defaultMemoryBlockSchema(String(block.kind ?? ''))).filter((schema): schema is Record<string, unknown> => Boolean(schema))
  return {
    backend: authoredStoreName(object, localInitializers),
    evictionPolicy: stringProperty(object, 'evictionPolicy'),
    blocks: blocks.length > 0 ? blocks.map(({ objectArg: _objectArg, ...block }) => block) : undefined,
    blockCount: blocks.length > 0 ? blocks.length : undefined,
    schema: workingSchemas.length === 1 ? workingSchemas[0].schema : defaultSchemas.length === 1 ? defaultSchemas[0] : undefined,
  }
}

interface MemoryBlockMetadata {
  readonly id?: string
  readonly kind?: string
  readonly priority?: number
  readonly schema?: Record<string, unknown>
  readonly writeMode?: string
  readonly hasEmbed: boolean
  readonly objectArg: ts.ObjectLiteralExpression
}

function memoryBlockMetadata(
  object: ts.ObjectLiteralExpression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): MemoryBlockMetadata[] {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === 'blocks')
  if (!property || !ts.isArrayLiteralExpression(property.initializer)) return []
  const blocks: MemoryBlockMetadata[] = []
  for (const element of property.initializer.elements) {
    const expression = resolveIdentifierExpression(element, localInitializers)
    if (!ts.isCallExpression(expression)) continue
    const callName = expressionName(expression.expression)
    const [firstArg] = expression.arguments
    if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) continue
    const id = stringProperty(firstArg, 'id')
    const kind = memoryBlockKindForCall(callName, firstArg)
    blocks.push({
      id,
      kind,
      priority: numberProperty(firstArg, 'priority'),
      schema: schemaProperty(firstArg, 'schema', localInitializers) ?? defaultMemoryBlockSchema(kind),
      writeMode: nestedStringProperty(firstArg, ['write', 'mode']),
      hasEmbed: hasProperty(firstArg, 'embed'),
      objectArg: firstArg,
    })
  }
  return blocks
}

function defaultMemoryBlockSchema(kind: string | undefined): Record<string, unknown> | undefined {
  switch (kind) {
    case 'episodes':
      return {
        name: 'EpisodicEntry',
        type: 'object',
        properties: {
          content: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
          createdAt: { type: 'number' },
          updatedAt: { type: 'number' },
        },
        required: ['content'],
        additionalProperties: true,
      }
    case 'facts':
    case 'procedures':
    case 'reflections':
      return {
        name: kind === 'facts' ? 'SemanticFact' : kind === 'procedures' ? 'ProcedureMemory' : 'ReflectionMemory',
        type: 'object',
        properties: {
          content: { type: 'string' },
          metadata: { type: 'object', additionalProperties: true },
          confidence: { type: 'number' },
          createdAt: { type: 'number' },
          updatedAt: { type: 'number' },
        },
        required: ['content'],
        additionalProperties: true,
      }
    default:
      return undefined
  }
}

function memoryBlockKindForCall(callName: string | undefined, object: ts.ObjectLiteralExpression): string | undefined {
  if (!callName) return stringProperty(object, 'kind')
  switch (callName) {
    case 'workingState':
      return 'working'
    case 'recentMessages':
      return 'recent'
    case 'episodes':
      return 'episodes'
    case 'facts':
      return 'facts'
    case 'procedures':
      return 'procedures'
    case 'reflections':
      return 'reflections'
    case 'memoryBlock':
      return stringProperty(object, 'kind') ?? 'custom'
    default:
      return undefined
  }
}

function authoredStoreName(object: ts.ObjectLiteralExpression, localInitializers: ReadonlyMap<string, ts.Expression>): string | undefined {
  const store = authoredStoreMetadata(object, localInitializers)
  return store?.backend ?? store?.name
}

function authoredStoreDefinition(
  ctx: Parameters<PrimitiveExtractor['extract']>[0],
  ownerKey: string,
  parentDefinitionId: string,
  parentRelationType: 'memory.uses_store' | 'blackboard.uses_store',
  object: ts.ObjectLiteralExpression,
): { definition: ReturnType<typeof ctx.define> } | undefined {
  const store = authoredStoreMetadata(object, ctx.localInitializers)
  if (!store) return undefined
  const storeId = `memory.store:${ctx.safeId(ownerKey)}:${ctx.safeId(store.name)}`
  return {
    definition: ctx.define(storeId, 'memory.store', store.name, store.objectArg, {
      exportName: ctx.variableName,
      ownerDefinitionKey: ownerKey,
      catalogPresentation: foldedCatalogChild({
        parentDefinitionId,
        parentRelationType,
        role: 'store',
      }),
      backend: store.backend,
      variableName: store.variableName,
      component: store.component,
    }),
  }
}

interface AuthoredStoreMetadata {
  readonly name: string
  readonly backend?: string
  readonly variableName?: string
  readonly component?: string
  readonly objectArg?: ts.ObjectLiteralExpression
}

function authoredStoreMetadata(
  object: ts.ObjectLiteralExpression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): AuthoredStoreMetadata | undefined {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && propertyName(item.name) === 'store',
  )
  if (!property) return undefined
  const propertyInitializer = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer
  const variableName = ts.isIdentifier(propertyInitializer) ? propertyInitializer.text : undefined
  const initializer = resolveIdentifierExpression(propertyInitializer, localInitializers)
  if (ts.isIdentifier(initializer)) return { name: initializer.text, variableName }
  if (ts.isCallExpression(initializer)) {
    const backend = expressionName(initializer.expression)
    const [firstArg] = initializer.arguments
    const objectArg = firstArg && ts.isObjectLiteralExpression(firstArg) ? firstArg : undefined
    return {
      name: variableName ?? backend ?? 'store',
      backend,
      variableName,
      component: objectArg ? nestedStringProperty(objectArg, ['component']) ?? componentProperty(objectArg) : undefined,
      objectArg,
    }
  }
  return undefined
}

function componentProperty(object: ts.ObjectLiteralExpression): string | undefined {
  const property = object.properties.find((item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === 'component')
  if (!property) return undefined
  return expressionName(property.initializer)
}

function resolveIdentifierExpression(expression: ts.Expression, localInitializers: ReadonlyMap<string, ts.Expression>): ts.Expression {
  return ts.isIdentifier(expression) ? (localInitializers.get(expression.text) ?? expression) : expression
}

function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}
