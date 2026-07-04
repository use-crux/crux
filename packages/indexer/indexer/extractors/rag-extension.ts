import type { ProjectDefinition } from '@use-crux/core/project-index'
import type { IndexExtractor, ConfigReader, ConfiguredObjectReader } from '../extensions'
import { facts } from '../extensions'
import { foldedIndexChild } from '../index-presentation'
import { storageConfigReferences, storageDependencyFacts, storageRelationRefs } from './storage-dependencies'

/**
 * Extracts knowledge-base, retriever, and retrieval-recipe definitions.
 *
 * Retriever and recipe extraction both use stable readers. Recipe steps are
 * projected from object-array config entries so the extractor does not expose
 * parser-owned TypeScript nodes.
 */
export const ragRetrieverIndexExtractor: IndexExtractor = {
  name: 'rag.retriever',
  patterns: [
    { kind: 'call', name: 'knowledgeBase' },
    { kind: 'call', name: 'reranker' },
    { kind: 'call', name: 'retriever' },
    { kind: 'call', name: 'retrievalRecipe' },
  ],
  extract: (ctx) => {
    if (ctx.match.name === 'knowledgeBase' && ctx.config) {
      const explicitId = ctx.config.string('id')
      const name = explicitId ?? ctx.source.variableName
      return facts({
        definitions: [
          ctx.define.definition({
            variableName: ctx.source.variableName,
            id: `rag.knowledgeBase:${ctx.source.safeId(explicitId ?? ctx.source.localName)}`,
            kind: 'rag.knowledgeBase',
            name,
            metadata: {
              exportName: ctx.source.variableName,
              namespace: explicitId,
              facts: {
                kind: 'rag.knowledgeBase',
                knowledgeBaseId: explicitId ?? ctx.source.variableName,
              },
              intelligence: {
                confidence: 'static',
              },
            },
          }),
        ],
      })
    }

    if (ctx.match.name === 'reranker' && ctx.config) {
      const explicitName = ctx.config.string('id') ?? ctx.config.string('name')
      const name = explicitName ?? ctx.source.variableName
      return facts({
        definitions: [
          ctx.define.definition({
            variableName: ctx.source.variableName,
            id: `rag.reranker:${ctx.source.safeId(explicitName ?? ctx.source.localName)}`,
            kind: 'rag.reranker',
            name,
            metadata: {
              exportName: ctx.source.variableName,
              facts: {
                kind: 'rag.reranker',
                rerankerId: explicitName ?? ctx.source.variableName,
              },
              intelligence: {
                confidence: 'static',
              },
            },
          }),
        ],
      })
    }

    if (ctx.match.name === 'retriever' && ctx.config) {
      const explicitId = ctx.config.string('id')
      const name = explicitId ?? ctx.source.variableName
      const storageRefs = storageConfigReferences(ctx.config)
      const storageDependencies = storageDependencyFacts(storageRefs)
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
                ...(storageDependencies ? { dependencies: storageDependencies } : {}),
              },
            },
          }),
        ],
        references: storageRelationRefs('rag.retriever', storageRefs),
      })
    }

    if (ctx.match.name === 'retrievalRecipe' && ctx.config) {
      const retrieverRef = ctx.config.reference('retriever')
      const explicitId = ctx.config.string('id')
      const name = explicitId ?? ctx.source.variableName
      const id = `rag.recipe:${ctx.source.safeId(explicitId ?? ctx.source.variableName)}`
      const steps = ragRecipeStepDefinitions(ctx, id)
      const retrievers = uniqueDefined([retrieverRef, ...steps.map((step) => step.retrieverVariable)])
      const scorers = uniqueDefined(steps.map((step) => step.scorerVariable))
      const rerankers = uniqueDefined(steps.map((step) => step.rerankerVariable))
      const recipeDefinition = ctx.define.definition({
        variableName: ctx.source.variableName,
        id,
        kind: 'rag.recipe',
        name,
        metadata: {
          exportName: ctx.source.variableName,
          facts: {
            kind: 'rag.recipe',
            recipeId: explicitId ?? ctx.source.variableName,
          },
          intelligence: {
            confidence: 'static',
            control: {
              mode: 'sequential',
              ordering: 'ordered',
              ...(steps.length > 0 ? { children: steps.map((step) => step.definition.id) } : {}),
            },
            ...(retrievers.length > 0 || scorers.length > 0 || rerankers.length > 0
              ? {
                  dependencies: {
                    ...(retrievers.length > 0 ? { retrievers } : {}),
                    ...(scorers.length > 0 ? { scorers } : {}),
                    ...(rerankers.length > 0 ? { rerankers } : {}),
                  },
                }
              : {}),
            ...(steps.length > 0 ? { children: steps.map((step) => step.definition.id) } : {}),
          },
        },
      })
      return facts({
        definitions: [
          {
            ...recipeDefinition,
            extraDefinitions: steps.map((step) => step.definition),
          },
        ],
        references: [
          ...(retrieverRef ? [ctx.ref.variable('rag.recipe.uses_retriever', retrieverRef)] : []),
          ...steps.flatMap((step) => [
            ctx.ref.id('rag.recipe.includes_step', step.definition.id),
            ...(step.retrieverVariable
              ? [
                  {
                    ...ctx.ref.variable('rag.recipe.step.uses_retriever', step.retrieverVariable),
                    fromId: step.definition.id,
                  },
                ]
              : []),
            ...(step.scorerVariable
              ? [
                  {
                    ...ctx.ref.variable('rag.recipe.step.uses_scorer', step.scorerVariable),
                    fromId: step.definition.id,
                  },
                ]
              : []),
            ...(step.rerankerVariable
              ? [
                  {
                    ...ctx.ref.variable('rag.recipe.step.uses_reranker', step.rerankerVariable),
                    fromId: step.definition.id,
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
 * Internal projection of one retrieval recipe step.
 *
 * The step keeps only index-facing data: id/name/type/order/source target. Step source has already
 * been projected through stable config readers before this structure is created.
 */
interface RagRecipeStep {
  readonly definition: ProjectDefinition
  readonly retrieverVariable?: string
  readonly scorerVariable?: string
  readonly rerankerVariable?: string
}

/**
 * Converts retrieval-recipe step config readers into folded index child definitions.
 *
 * Unsupported step entries are skipped conservatively by the argument reader before this helper runs,
 * preserving current behavior without exposing arbitrary AST traversal to extension authors.
 */
function ragRecipeStepDefinitions(
  ctx: Parameters<IndexExtractor['extract']>[0],
  recipeDefinitionId: string,
): RagRecipeStep[] {
  return recipeStepReaders(ctx.config).map((step, index) =>
    stepDefinition(ctx, recipeDefinitionId, step.config, index, step.callName),
  )
}

/**
 * Reads both object-literal steps and configured helper calls such as
 * `rerank({ engine })` through the stable extractor API.
 */
function recipeStepReaders(
  config: ConfigReader | undefined,
): Array<{ readonly config: ConfigReader; readonly callName?: string }> {
  if (!config) return []
  return config.objectOrCallObjectArray('steps').map((step) => ({ config: step.config, callName: step.name }))
}

/** Deduplicates optional step refs while dropping unsupported/missing values. */
function uniqueDefined(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))]
}

/**
 * Builds one folded retrieval-recipe step definition from a stable config reader.
 *
 * Keeping step projection reader-based means future parser profiles can support the same extractor
 * without providing TypeScript object literals.
 */
function stepDefinition(
  ctx: Parameters<IndexExtractor['extract']>[0],
  recipeDefinitionId: string,
  stepConfig: ConfigReader,
  index: number,
  callName?: ConfiguredObjectReader['name'],
): RagRecipeStep {
  const stepId = stepConfig.string('id') ?? stepConfig.string('name') ?? callName ?? `step-${index + 1}`
  const retrieverVariable = stepConfig.identifier('retriever')
  const scorerVariable = stepConfig.identifier('scorer') ?? stepConfig.identifier('judge')
  const rerankerVariable = stepConfig.identifier('engine') ?? stepConfig.identifier('reranker')
  return {
    definition: ctx.define.definition({
      variableName: ctx.source.variableName,
      id: `${recipeDefinitionId}:step:${ctx.source.safeId(stepId)}`,
      kind: 'rag.recipe.step',
      name: stepId,
      metadata: {
        recipeId: recipeDefinitionId,
        stepId,
        index,
        ...(retrieverVariable ? { retrieverVariable } : {}),
        ...(scorerVariable ? { scorerVariable } : {}),
        ...(rerankerVariable ? { rerankerVariable } : {}),
        indexPresentation: foldedIndexChild({
          parentDefinitionId: recipeDefinitionId,
          parentRelationType: 'rag.recipe.includes_step',
          role: 'step',
          order: index,
        }),
        facts: {
          kind: 'rag.recipe.step',
          stepId,
          index,
          ...(retrieverVariable ? { retrieverId: retrieverVariable } : {}),
          ...(rerankerVariable ? { rerankerId: rerankerVariable } : {}),
        },
        intelligence: {
          confidence: 'static',
          control: { mode: 'sequential', ordering: 'ordered' },
          ...(retrieverVariable || scorerVariable || rerankerVariable
            ? {
                dependencies: {
                  ...(retrieverVariable ? { retrievers: [retrieverVariable] } : {}),
                  ...(scorerVariable ? { scorers: [scorerVariable] } : {}),
                  ...(rerankerVariable ? { rerankers: [rerankerVariable] } : {}),
                },
              }
            : {}),
        },
      },
    }).definition,
    retrieverVariable,
    scorerVariable,
    rerankerVariable,
  }
}
