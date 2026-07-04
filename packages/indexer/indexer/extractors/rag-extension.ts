import type { ProjectDefinition } from '@use-crux/core/project-index'
import type { IndexExtractor, ConfigReader } from '../extensions'
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
            ...(retrievers.length > 0 || scorers.length > 0
              ? {
                  dependencies: {
                    ...(retrievers.length > 0 ? { retrievers } : {}),
                    ...(scorers.length > 0 ? { scorers } : {}),
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
  return (ctx.config?.objectArray('steps') ?? []).map((stepConfig, index) =>
    stepDefinition(ctx, recipeDefinitionId, stepConfig, index),
  )
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
): RagRecipeStep {
  const stepId = stepConfig.string('id') ?? stepConfig.string('name') ?? `step-${index + 1}`
  const retrieverVariable = stepConfig.identifier('retriever')
  const scorerVariable =
    stepConfig.identifier('scorer') ?? stepConfig.identifier('judge') ?? stepConfig.identifier('reranker')
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
