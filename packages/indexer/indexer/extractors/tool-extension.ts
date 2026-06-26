import type { StaticRelationRef } from '../types'
import { facts, type IndexExtractor, type ExtractContext } from '../extensions'
import {
  internalDataAccessRefsForConfigObject,
  internalDataAccessRefsForConfigProperties,
} from '../static-index/compatibility/syntax-record-bridge/data-access'
import { primitiveDataIntelligence, uniqueDataAccesses, type PrimitiveDataAccessRef } from './data-access'

const callbackProperties = ['execute', 'run', 'handler'] as const

/**
 * Extracts `tool(...)` definitions from source-local tool configuration.
 *
 * The extractor captures tool identity, input/output schemas, handler source refs, runtime join
 * metadata, and visible data access as facts rather than mutating the index graph.
 */
export const toolIndexExtractor: IndexExtractor = {
  name: 'tool',
  patterns: [{ kind: 'object' }, { kind: 'call', name: 'createTool' }, { kind: 'call', name: 'tool' }],
  extract: (ctx) => {
    if (!ctx.config) return { kind: 'none' }
    if (ctx.match.kind === 'object' && !isToolSchemaObject(ctx)) return { kind: 'none' }
    const explicitName = ctx.config.string('name') ?? ctx.config.string('title')
    const id = `tool:${ctx.source.safeId(explicitName ?? ctx.source.variableName)}`
    const inputSchema = ctx.sourceRef.schemaProperty({ property: 'input', definitionId: id })
    const namedInputSchema = ctx.sourceRef.schemaProperty({ property: 'inputSchema', definitionId: id })
    const parametersSchema = ctx.sourceRef.schemaProperty({ property: 'parameters', definitionId: id })
    const schema = inputSchema.schema ? inputSchema : namedInputSchema.schema ? namedInputSchema : parametersSchema
    const dataAccesses = uniqueDataAccesses([
      ...internalDataAccessRefsForConfigObject(ctx),
      ...internalDataAccessRefsForConfigProperties(ctx, callbackProperties),
    ])
    const dataIntelligence = primitiveDataIntelligence(dataAccesses)
    const sourceRefs = [
      ...inputSchema.sourceRefs,
      ...namedInputSchema.sourceRefs,
      ...parametersSchema.sourceRefs,
      ...callbackProperties
        .map((property) =>
          ctx.sourceRef.callbackProperty({
            property,
            role: property === 'execute' ? 'execute' : property === 'handler' ? 'handler' : 'callback',
            definitionId: id,
          }),
        )
        .filter(isDefined),
      ...callbackProperties.flatMap((property) => ctx.sourceRef.helperRefsForProperty({ property, definitionId: id })),
    ]
    const hasExecute = ctx.config.has('execute') || ctx.config.has('run') || ctx.config.has('handler')
    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'tool',
          name: explicitName ?? ctx.source.variableName,
          metadata: {
            exportName: ctx.source.variableName,
            inputSchema: schema.schema,
            hasExecute,
            hasToModelOutput: ctx.config.has('toModelOutput'),
            facts: {
              kind: 'tool',
              toolName: explicitName ?? ctx.source.variableName,
              hasExecute,
              hasToModelOutput: ctx.config.has('toModelOutput'),
            },
            intelligence: {
              confidence: 'static',
              ...(schema.schema ? { contract: { inputSchema: schema.schema } } : {}),
              ...(dataIntelligence?.data ? { data: dataIntelligence.data } : {}),
            },
          },
        }),
      ],
      sourceRefs,
      references: dataAccessRelationRefs(id, dataAccesses),
    })
  },
}

/** Detects object-literal tool schemas that are authored without a `tool(...)` wrapper. */
function isToolSchemaObject(ctx: ExtractContext): boolean {
  return Boolean(
    ctx.config?.string('name') &&
    ctx.config.string('description') &&
    (ctx.config.has('input') || ctx.config.has('inputSchema') || ctx.config.has('parameters')),
  )
}

/** Converts tool handler data access into unresolved read/write relation refs. */
function dataAccessRelationRefs(fromId: string, accesses: readonly PrimitiveDataAccessRef[]): StaticRelationRef[] {
  return accesses.map((access) => ({
    type: access.kind === 'read' ? 'tool.reads_memory' : 'tool.writes_memory',
    typeByTargetKind:
      access.kind === 'read'
        ? {
            memory: 'tool.reads_memory',
            blackboard: 'tool.reads_blackboard',
            workspace: 'tool.reads_workspace',
          }
        : {
            memory: 'tool.writes_memory',
            blackboard: 'tool.writes_blackboard',
            workspace: 'tool.writes_workspace',
          },
    fromId,
    toVariable: access.targetVariable,
  }))
}

/** Removes absent source refs after conservative source-ref construction. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
