import ts from 'typescript'
import type { ProjectDefinition } from '@crux/core/project-index'
import { foldedIndexChild } from '../index-presentation'
import {
  facts,
  type IndexExtractor,
  type ConfigCallReader,
  type ConfigReader,
  type ExtractContext,
} from '../extensions'
import { internalAuthoredMemoryId } from '../extensions/internal-config'
import { internalStaticCallContext } from '../extensions/internal-native'
import type { StaticRelationRef } from '../types'

/**
 * Extracts authored memory definitions, memory block metadata, and backing store facts.
 *
 * Memory has several source shapes (`memory`, `recentMessages`, `workingState`, dense blocks, stores).
 * This extractor normalizes those shapes into index definitions and folded store definitions while
 * preserving retention/schema intelligence for detail views and lint rules.
 */
export const memoryIndexExtractor: IndexExtractor = {
  name: 'memory',
  patterns: [{ kind: 'call', name: 'memory' }],
  extract: (ctx) => {
    const staticCtx = internalStaticCallContext(ctx)
    if (!ctx.config) return { kind: 'none' }
    const idInfo = internalAuthoredMemoryId(ctx)
    const definitionKey = idInfo.definitionKey ?? ctx.source.localName
    const id = `memory:${ctx.source.safeId(definitionKey)}`
    const blocks = memoryBlockMetadata(ctx.config)
    const store = authoredStoreDefinition(
      ctx,
      definitionKey,
      id,
      'memory.uses_store',
      ctx.config,
      staticCtx?.objectArg,
      staticCtx?.localInitializers,
    )
    const blockDefinitions = blocks.map((block, index) =>
      projectDefinitionFromContext(ctx, {
        id: `memory.block:${ctx.source.safeId(definitionKey)}:${ctx.source.safeId(block.id ?? block.kind ?? 'block')}`,
        kind: 'memory.block',
        name: block.id ?? block.kind ?? 'block',
        metadata: {
          exportName: ctx.source.variableName,
          memoryId: id,
          blockId: block.id,
          blockKind: block.kind,
          indexPresentation: foldedIndexChild({
            parentDefinitionId: id,
            parentRelationType: 'memory.includes_block',
            role: 'block',
            order: index,
          }),
          priority: block.priority,
          schema: block.schema,
          writeMode: block.writeMode,
          hasEmbed: block.hasEmbed,
          facts: {
            kind: 'memory.block',
            memoryId: id,
            blockId: block.id,
            blockKind: block.kind,
            priority: block.priority,
            writeMode: block.writeMode,
            hasEmbed: block.hasEmbed,
          },
        },
      }),
    )
    const extraDefinitions = [...blockDefinitions, ...(store ? [store.definition] : [])]
    const references: StaticRelationRef[] = [
      ...blockDefinitions.map((definition) => ({ type: 'memory.includes_block', toId: definition.id })),
      ...(store ? [{ type: 'memory.uses_store', toId: store.definition.id }] : []),
    ]
    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'memory',
          name: idInfo.displayName ?? ctx.source.variableName,
          metadata: {
            exportName: ctx.source.variableName,
            runtimeIdPrefix: idInfo.runtimeIdPrefix,
            ...staticMemoryMetadata(blocks, ctx.config, {
              blockDefinitionIds: blockDefinitions.map((definition) => definition.id),
              storeDefinitionId: store?.definition.id,
            }),
          },
        }),
        ...extraDefinitions.map((definition) => ({
          variableName: ctx.source.variableName,
          definition,
        })),
      ],
      references,
    })
  },
}

/**
 * Extracts shared blackboard definitions and conflict-policy metadata.
 *
 * Blackboard facts help index consumers identify shared writable state and reason about merge or
 * conflict behavior without executing runtime orchestration.
 */
export const blackboardIndexExtractor: IndexExtractor = {
  name: 'blackboard',
  patterns: [{ kind: 'call', name: 'blackboard' }],
  extract: (ctx) => {
    const staticCtx = internalStaticCallContext(ctx)
    if (!ctx.config) return { kind: 'none' }
    const idInfo = internalAuthoredMemoryId(ctx)
    const definitionKey = idInfo.definitionKey ?? ctx.source.localName
    const id = `blackboard:${ctx.source.safeId(definitionKey)}`
    const store = authoredStoreDefinition(
      ctx,
      definitionKey,
      id,
      'blackboard.uses_store',
      ctx.config,
      staticCtx?.objectArg,
      staticCtx?.localInitializers,
    )
    const schema = ctx.config.schema('schema')
    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'blackboard',
          name: idInfo.displayName ?? ctx.source.variableName,
          metadata: {
            exportName: ctx.source.variableName,
            schema,
            facts: {
              kind: 'blackboard',
              backend: authoredStoreName(ctx.config),
              conflictPolicy: ctx.config.string('conflictPolicy'),
              runtimeIdPrefix: idInfo.runtimeIdPrefix,
            },
            backend: authoredStoreName(ctx.config),
            conflictPolicy: ctx.config.string('conflictPolicy'),
            runtimeIdPrefix: idInfo.runtimeIdPrefix,
            intelligence: {
              confidence: 'static',
              ...(schema ? { contract: { schema } } : {}),
              ...(store ? { dependencies: { stores: [store.definition.id] } } : {}),
            },
          },
        }),
        ...(store ? [{ variableName: ctx.source.variableName, definition: store.definition }] : []),
      ],
      references: store ? [{ type: 'blackboard.uses_store', toId: store.definition.id }] : [],
    })
  },
}

/**
 * Internal static context used by memory helpers that still inspect TypeScript object literals.
 *
 * This is intentionally not exported from the public extension barrel; it supports first-party
 * compatibility until the stable readers cover all memory source shapes.
 */
/** Index-facing metadata for one memory block declared inside a memory config. */
interface MemoryBlockMetadata {
  readonly id?: string
  readonly kind?: string
  readonly priority?: number
  readonly schema?: Record<string, unknown>
  readonly writeMode?: string
  readonly hasEmbed: boolean
}

/** Static metadata for an authored memory store referenced by a memory definition. */
interface AuthoredStoreMetadata {
  readonly name: string
  readonly backend?: string
  readonly variableName?: string
  readonly component?: string
}

/**
 * Builds structured memory metadata from block and store observations.
 *
 * The metadata separates data/contract/runtime concerns so index consumers do not need to parse raw
 * memory config objects.
 */
function staticMemoryMetadata(
  blocks: readonly MemoryBlockMetadata[],
  config: ConfigReader,
  related: {
    readonly blockDefinitionIds: readonly string[]
    readonly storeDefinitionId?: string
  },
): Record<string, unknown> {
  const workingSchemas = blocks.filter((block) => block.kind === 'working' && block.schema)
  const defaultSchemas = blocks
    .map((block) => block.schema ?? defaultMemoryBlockSchema(String(block.kind ?? '')))
    .filter(isRecord)
  const schema =
    workingSchemas.length === 1 ? workingSchemas[0].schema : defaultSchemas.length === 1 ? defaultSchemas[0] : undefined
  const backend = authoredStoreName(config)
  return {
    backend,
    evictionPolicy: config.string('evictionPolicy'),
    blocks: blocks.length > 0 ? blocks : undefined,
    blockCount: blocks.length > 0 ? blocks.length : undefined,
    schema,
    facts: {
      kind: 'memory',
      backend,
      evictionPolicy: config.string('evictionPolicy'),
      blockCount: blocks.length > 0 ? blocks.length : undefined,
    },
    intelligence: {
      confidence: 'static',
      ...(schema ? { contract: { schema } } : {}),
      dependencies: {
        ...(related.blockDefinitionIds.length > 0 ? { blocks: [...related.blockDefinitionIds] } : {}),
        ...(related.storeDefinitionId ? { stores: [related.storeDefinitionId] } : {}),
      },
    },
  }
}

/**
 * Projects one memory block object into index-facing metadata.
 *
 * The helper resolves local schema aliases and conservative literals but skips unsupported expressions
 * rather than exposing raw AST details.
 */
function memoryBlockMetadata(config: ConfigReader): readonly MemoryBlockMetadata[] {
  return config.callObjectArray('blocks').map((block) => memoryBlockMetadataFromCall(block))
}

/** Projects one configured memory block helper call into index-facing metadata. */
function memoryBlockMetadataFromCall(block: ConfigCallReader): MemoryBlockMetadata {
  const id = block.config.string('id')
  const kind = memoryBlockKindForCall(block.name, block.config)
  return {
    id,
    kind,
    priority: block.config.number('priority'),
    schema: block.config.schema('schema') ?? defaultMemoryBlockSchema(kind),
    writeMode: block.config.nestedString(['write', 'mode']),
    hasEmbed: block.config.has('embed'),
  }
}

/** Supplies default schemas for built-in memory block kinds when authors omit an explicit schema. */
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

/** Determines a memory block kind from either the factory call or an explicit `kind` property. */
function memoryBlockKindForCall(callName: string | undefined, config: ConfigReader): string | undefined {
  if (!callName) return config.string('kind')
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
      return config.string('kind') ?? 'custom'
    default:
      return undefined
  }
}

/** Reads the display name for a memory store referenced by a memory config object. */
function authoredStoreName(config: ConfigReader): string | undefined {
  const store = authoredStoreMetadata(config)
  return store?.backend ?? store?.name
}

/**
 * Builds a folded store definition for memory configs that reference an authored store.
 *
 * Store definitions are emitted as extra definitions so state backing resources remain visible in the
 * index while staying attached to the memory primitive that declared them.
 */
function authoredStoreDefinition(
  ctx: ExtractContext,
  ownerKey: string,
  parentDefinitionId: string,
  parentRelationType: 'memory.uses_store' | 'blackboard.uses_store',
  config: ConfigReader,
  object: ts.ObjectLiteralExpression | undefined,
  localInitializers: ReadonlyMap<string, ts.Expression> | undefined,
): { readonly definition: ProjectDefinition } | undefined {
  const store = authoredStoreMetadata(config, object, localInitializers)
  if (!store) return undefined
  const storeId = `memory.store:${ctx.source.safeId(ownerKey)}:${ctx.source.safeId(store.name)}`
  return {
    definition: projectDefinitionFromContext(ctx, {
      id: storeId,
      kind: 'memory.store',
      name: store.name,
      metadata: {
        exportName: ctx.source.variableName,
        ownerDefinitionKey: ownerKey,
        indexPresentation: foldedIndexChild({
          parentDefinitionId,
          parentRelationType,
          role: 'store',
        }),
        backend: store.backend,
        variableName: store.variableName,
        component: store.component,
        facts: {
          kind: 'memory.store',
          ownerDefinitionKey: ownerKey,
          backend: store.backend,
          variableName: store.variableName,
          component: store.component,
        },
      },
    }),
  }
}

/** Projects static store configuration into index metadata for memory backing resources. */
function authoredStoreMetadata(
  config: ConfigReader,
  object?: ts.ObjectLiteralExpression,
  localInitializers: ReadonlyMap<string, ts.Expression> = new Map(),
): AuthoredStoreMetadata | undefined {
  const storeCall = config.callObject('store')
  const variableName = config.reference('store')
  if (!storeCall) return variableName ? { name: variableName, variableName } : undefined
  const backend = storeCall.name
  return {
    name: variableName ?? backend ?? 'store',
    backend,
    variableName,
    component:
      storeCall.config.nestedString(['component']) ??
      storeCall.config.reference('component') ??
      (object ? authoredStoreComponentFallback(object, localInitializers) : undefined),
  }
}

/**
 * Preserves legacy component extraction for rare store shapes not covered by stable call readers.
 *
 * The normal path uses `ConfigReader.callObject('store')`; this fallback keeps compatibility while the
 * remaining native memory-id handling is still first-party/internal.
 */
function authoredStoreComponentFallback(
  object: ts.ObjectLiteralExpression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): string | undefined {
  const property = propertyAssignment(object, 'store')
  if (!property) return undefined
  const initializer = resolveIdentifierExpression(property.initializer, localInitializers)
  if (!ts.isCallExpression(initializer)) return undefined
  const [firstArg] = initializer.arguments
  if (!firstArg || !ts.isObjectLiteralExpression(firstArg)) return undefined
  return nestedStringProperty(firstArg, ['component']) ?? configComponentProperty(firstArg)
}

/** Reads the component binding from a store config, including property-access component references. */
function configComponentProperty(object: ts.ObjectLiteralExpression): string | undefined {
  const property = propertyAssignment(object, 'component')
  return property ? expressionName(property.initializer) : undefined
}

/** Builds child/store definitions with source defaults inherited from the parent memory context. */
function projectDefinitionFromContext(
  ctx: ExtractContext,
  input: {
    readonly id: string
    readonly kind: Parameters<ExtractContext['define']['definition']>[0]['kind']
    readonly name: string
    readonly metadata: Readonly<Record<string, unknown>>
  },
): ProjectDefinition {
  return ctx.define.definition({
    variableName: ctx.source.variableName,
    id: input.id,
    kind: input.kind,
    name: input.name,
    metadata: input.metadata,
  }).definition
}

/** Finds a direct property assignment by stable property name. */
function propertyAssignment(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === name,
  )
}

/** Converts supported TypeScript property names into stable string keys. */
function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

/** Reads a nested string property such as `retention.ttl` without exposing nested AST nodes. */
function nestedStringProperty(object: ts.ObjectLiteralExpression, path: readonly string[]): string | undefined {
  let current: ts.Expression | undefined = object
  for (const segment of path) {
    if (!current || !ts.isObjectLiteralExpression(current)) return undefined
    const property = propertyAssignment(current, segment)
    if (!property) return undefined
    current = property.initializer
  }
  return current && ts.isStringLiteralLike(current) ? current.text : undefined
}

/** Resolves one local identifier alias before literal/schema projection. */
function resolveIdentifierExpression(
  expression: ts.Expression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression {
  return ts.isIdentifier(expression) ? (localInitializers.get(expression.text) ?? expression) : expression
}

/** Reads the identifier or property name represented by an expression. */
function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

/** Removes absent metadata records before spreading optional contract/runtime data. */
function isRecord(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
  return Boolean(value)
}
