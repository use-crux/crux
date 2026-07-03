/**
 * Retrieval & RAG beta: knowledge bases, retrievers, recipes, and grounding.
 *
 * Start with {@link knowledgeBase} for common RAG flows, drop down to
 * {@link retriever} for custom read paths, and compose retrieval work with
 * named recipes in later beta phases.
 *
 * @module
 */

export { knowledgeBase } from './knowledge-base'
export { retriever } from './define-retriever'
export { retrievalRecipe } from './recipe/recipe'
export { compressToBudget, expandParents, fanout, rerank, retrievalStep, retrieve, rewriteQuery } from './recipe/step'
export { RetrievalNotImplementedError } from './errors'
export { grounding } from '../citations'

export type { Grounding } from '../citations'
export type {
  KnowledgeBase,
  KnowledgeBaseConfig,
  KnowledgeBaseInspection,
  KnowledgeBaseScopeConfig,
  ScopedKnowledgeBase,
} from './knowledge-base'
export type { RetrievalModel } from './model'
export type { MetadataFilter, RetrieveOptions, RetrieveRequest } from './request'
export type { RecipeTrace, RetrievalRecipe, RetrievalRecipeConfig, StepTrace } from './recipe/recipe'
export type {
  PlannedQuery,
  RetrievalStep,
  RetrievalStepConfig,
  RetrievalStepContext,
  RetrievalStepKind,
  StepInput,
  StepOutput,
  StepPhase,
} from './recipe/step'
export type {
  RetrievalInjectMode,
  RetrievalToolConfig,
  RetrievalToolName,
  Retriever,
  RetrieverHit,
  RetrieverMode,
  RetrieverTools,
} from './types'
