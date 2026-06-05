import ts from 'typescript'
import type { ProjectDefinition } from '@crux/core/catalog'
import { identifierProperty, stringProperty } from '../ast/literals'
import { foldedCatalogChild } from '../catalog-presentation'
import type { PrimitiveExtractor } from './types'
import { foundDefinition } from './types'

export const ragExtractor: PrimitiveExtractor = {
  name: 'rag',
  capabilities: ['definition', 'relation', 'source', 'runtime-join', 'partial'],
  callNames: ['retriever', 'retrievalPipeline'],
  extract: (ctx) => {
    if (ctx.callName === 'retriever' && ctx.objectArg) {
      const explicitId = stringProperty(ctx.objectArg, 'id')
      const id = `rag.retriever:${ctx.safeId(explicitId ?? ctx.localName)}`
      return foundDefinition(
        ctx.variableName,
        ctx.define(id, 'rag.retriever', explicitId ?? ctx.variableName, ctx.objectArg, {
          exportName: ctx.variableName,
          namespace: stringProperty(ctx.objectArg, 'namespace'),
        }),
      )
    }
    if (ctx.callName === 'retrievalPipeline') {
      const retrieverRef = ctx.firstArg && ts.isIdentifier(ctx.firstArg) ? ctx.firstArg.text : undefined
      const id = `rag.pipeline:${ctx.safeId(ctx.variableName)}`
      const stages = ragPipelineStageDefinitions(ctx, id)
      return foundDefinition(
        ctx.variableName,
        ctx.define(id, 'rag.pipeline', ctx.variableName, undefined, {
          exportName: ctx.variableName,
          intelligence: {
            confidence: 'static',
            control: { mode: 'sequential', ordering: 'ordered' },
            ...(stages.length > 0 ? { children: stages.map((stage) => stage.definition.id) } : {}),
          },
        }),
        [
          ...(retrieverRef ? [{ type: 'rag.pipeline.uses_retriever', toVariable: retrieverRef }] : []),
          ...stages.flatMap((stage) => [
            { type: 'rag.pipeline.includes_stage', fromId: id, toId: stage.definition.id },
            ...(stage.retrieverVariable ? [{ type: 'rag.pipeline.stage.uses_retriever', fromId: stage.definition.id, toVariable: stage.retrieverVariable }] : []),
            ...(stage.scorerVariable ? [{ type: 'rag.pipeline.stage.uses_scorer', fromId: stage.definition.id, toVariable: stage.scorerVariable }] : []),
          ]),
        ],
        stages.map((stage) => stage.definition),
      )
    }
    return undefined
  },
}

interface RagPipelineStage {
  readonly definition: ProjectDefinition
  readonly retrieverVariable?: string
  readonly scorerVariable?: string
}

function ragPipelineStageDefinitions(ctx: Parameters<PrimitiveExtractor['extract']>[0], pipelineId: string): RagPipelineStage[] {
  const stagesArg = ctx.call.arguments[1]
  if (!stagesArg || !ts.isArrayLiteralExpression(stagesArg)) return []
  return stagesArg.elements.flatMap((element, index) => {
    if (!ts.isObjectLiteralExpression(element)) return []
    const stageId = stringProperty(element, 'name') ?? `stage-${index + 1}`
    const retrieverVariable = identifierProperty(element, 'retriever')
    const scorerVariable = identifierProperty(element, 'scorer') ?? identifierProperty(element, 'judge') ?? identifierProperty(element, 'reranker')
    return [{
      definition: ctx.define(`${pipelineId}:stage:${ctx.safeId(stageId)}`, 'rag.pipeline.stage', stageId, element, {
        pipelineId,
        stageId,
        index,
        catalogPresentation: foldedCatalogChild({
          parentDefinitionId: pipelineId,
          parentRelationType: 'rag.pipeline.includes_stage',
          role: 'stage',
          order: index,
        }),
        ...(retrieverVariable ? { retrieverVariable } : {}),
        ...(scorerVariable ? { scorerVariable } : {}),
        intelligence: {
          confidence: 'static',
          control: { mode: 'sequential', ordering: 'ordered' },
        },
      }),
      retrieverVariable,
      scorerVariable,
    }]
  })
}
