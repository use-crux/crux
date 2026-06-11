import type { ProjectDefinition } from '@crux/core/project-index'
import type { IndexExtractor, ConfigReader } from '../extensions'
import { facts } from '../extensions'
import { foldedIndexChild } from '../index-presentation'

/**
 * Extracts retriever and retrieval-pipeline definitions.
 *
 * Retriever extraction and retrieval-pipeline extraction both use stable readers. Pipeline stages are
 * projected from object-array arguments so the extractor no longer needs parser-owned TypeScript nodes.
 */
export const ragRetrieverIndexExtractor: IndexExtractor = {
  name: 'rag.retriever',
  patterns: [
    { kind: 'call', name: 'retriever' },
    { kind: 'call', name: 'retrievalPipeline' },
  ],
  extract: (ctx) => {
    if (ctx.match.name === 'retriever' && ctx.config) {
      const explicitId = ctx.config.string('id')
      const name = explicitId ?? ctx.source.variableName
      return facts({
        definitions: [
          ctx.define.definition({
            variableName: ctx.source.variableName,
            id: `rag.retriever:${ctx.source.safeId(explicitId ?? ctx.source.localName)}`,
            kind: 'rag.retriever',
            name,
            metadata: {
              exportName: ctx.source.variableName,
              namespace: ctx.config.string('namespace'),
              facts: {
                kind: 'rag.retriever',
                retrieverId: explicitId ?? ctx.source.variableName,
              },
              intelligence: {
                confidence: 'static',
              },
            },
          }),
        ],
      })
    }

    if (ctx.match.name === 'retrievalPipeline') {
      const retrieverRef = ctx.args.identifier(0)
      const id = `rag.pipeline:${ctx.source.safeId(ctx.source.variableName)}`
      const stages = ragPipelineStageDefinitions(ctx, id)
      const retrievers = uniqueDefined([retrieverRef, ...stages.map((stage) => stage.retrieverVariable)])
      const scorers = uniqueDefined(stages.map((stage) => stage.scorerVariable))
      const pipelineDefinition = ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind: 'rag.pipeline',
        name: ctx.source.variableName,
        metadata: {
          exportName: ctx.source.variableName,
          facts: {
            kind: 'rag.pipeline',
          },
          intelligence: {
            confidence: 'static',
            control: {
              mode: 'sequential',
              ordering: 'ordered',
              ...(stages.length > 0 ? { children: stages.map((stage) => stage.definition.id) } : {}),
            },
            ...(retrievers.length > 0 || scorers.length > 0
              ? {
                  dependencies: {
                    ...(retrievers.length > 0 ? { retrievers } : {}),
                    ...(scorers.length > 0 ? { scorers } : {}),
                  },
                }
              : {}),
            ...(stages.length > 0 ? { children: stages.map((stage) => stage.definition.id) } : {}),
          },
        },
      })
      return facts({
        definitions: [
          {
            ...pipelineDefinition,
            extraDefinitions: stages.map((stage) => stage.definition),
          },
        ],
        references: [
          ...(retrieverRef ? [ctx.ref.variable('rag.pipeline.uses_retriever', retrieverRef)] : []),
          ...stages.flatMap((stage) => [
            ctx.ref.id('rag.pipeline.includes_stage', stage.definition.id),
            ...(stage.retrieverVariable
              ? [
                  {
                    ...ctx.ref.variable('rag.pipeline.stage.uses_retriever', stage.retrieverVariable),
                    fromId: stage.definition.id,
                  },
                ]
              : []),
            ...(stage.scorerVariable
              ? [
                  {
                    ...ctx.ref.variable('rag.pipeline.stage.uses_scorer', stage.scorerVariable),
                    fromId: stage.definition.id,
                  },
                ]
              : []),
          ]),
        ],
      })
    }

    return { kind: 'none' }
  },
}

/**
 * Internal projection of one retrieval pipeline stage.
 *
 * The stage keeps only index-facing data: id/name/type/order/source target. Stage source has already
 * been projected through stable config readers before this structure is created.
 */
interface RagPipelineStage {
  readonly definition: ProjectDefinition
  readonly retrieverVariable?: string
  readonly scorerVariable?: string
}

/**
 * Converts retrieval-pipeline stage config readers into folded index child definitions.
 *
 * Unsupported stage entries are skipped conservatively by the argument reader before this helper runs,
 * preserving current behavior without exposing arbitrary AST traversal to extension authors.
 */
function ragPipelineStageDefinitions(
  ctx: Parameters<IndexExtractor['extract']>[0],
  pipelineDefinitionId: string,
): RagPipelineStage[] {
  return ctx.args
    .objectArray(1)
    .map((stageConfig, index) => stageDefinition(ctx, pipelineDefinitionId, stageConfig, index))
}

/** Deduplicates optional stage refs while dropping unsupported/missing values. */
function uniqueDefined(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))]
}

/**
 * Builds one folded retrieval-pipeline stage definition from a stable config reader.
 *
 * Keeping stage projection reader-based means future parser profiles can support the same extractor
 * without providing TypeScript object literals.
 */
function stageDefinition(
  ctx: Parameters<IndexExtractor['extract']>[0],
  pipelineDefinitionId: string,
  stageConfig: ConfigReader,
  index: number,
): RagPipelineStage {
  const stageId = stageConfig.string('name') ?? `stage-${index + 1}`
  const retrieverVariable = stageConfig.identifier('retriever')
  const scorerVariable =
    stageConfig.identifier('scorer') ?? stageConfig.identifier('judge') ?? stageConfig.identifier('reranker')
  return {
    definition: ctx.define.definition({
      variableName: ctx.source.variableName,
      id: `${pipelineDefinitionId}:stage:${ctx.source.safeId(stageId)}`,
      kind: 'rag.pipeline.stage',
      name: stageId,
      metadata: {
        pipelineId: pipelineDefinitionId,
        stageId,
        index,
        ...(retrieverVariable ? { retrieverVariable } : {}),
        ...(scorerVariable ? { scorerVariable } : {}),
        indexPresentation: foldedIndexChild({
          parentDefinitionId: pipelineDefinitionId,
          parentRelationType: 'rag.pipeline.includes_stage',
          role: 'stage',
          order: index,
        }),
        facts: {
          kind: 'rag.pipeline.stage',
          stageId,
          index,
          ...(retrieverVariable ? { retrieverId: retrieverVariable } : {}),
        },
        intelligence: {
          confidence: 'static',
          control: { mode: 'sequential', ordering: 'ordered' },
          ...(retrieverVariable || scorerVariable
            ? {
                dependencies: {
                  ...(retrieverVariable ? { retrievers: [retrieverVariable] } : {}),
                  ...(scorerVariable ? { scorers: [scorerVariable] } : {}),
                },
              }
            : {}),
        },
      },
    }).definition,
    retrieverVariable,
    scorerVariable,
  }
}
