/**
 * Retrieval & RAG beta: knowledge bases, retrievers, recipes, and grounding.
 *
 * Start with {@link knowledgeBase} for common RAG flows, drop down to
 * {@link retriever} for custom read paths, and compose retrieval work with
 * named recipes when retrieval needs fanout, federation, ranking, or
 * compression.
 *
 * @module
 */

export { knowledgeBase } from './knowledge-base'
export { retriever } from './define-retriever'
export { retrievalRecipe } from './recipe/recipe'
export { retrievalStep } from './recipe/step'
export { compressToBudget, expandParents, fanout, rerank, retrieve, rewriteQuery } from './recipe/steps/built-ins'
export { judgeReranker } from './reranker'
export { RetrievalConfigError, RetrievalNotImplementedError, RetrievalRunError } from './errors'
export { RETRIEVAL_HITS_KIND, isRetrievalToolPayload } from './tools'
export { grounding } from '../citations'

export type { Grounding } from '../citations'
export type { RetrievalConfigErrorCode, RetrievalRunErrorCode } from './errors'
export type {
  KnowledgeBase,
  KnowledgeBaseConfig,
  KnowledgeBaseGroundingConfig,
  KnowledgeBaseInspection,
  KnowledgeBaseRecipeConfig,
  KnowledgeBaseScopeConfig,
  ScopedKnowledgeBase,
} from './knowledge-base'
export type { RetrievalModel } from './model'
export type { JudgeRerankerConfig, Reranker } from './reranker'
export type { MetadataFilter, RetrieveInput, RetrieveOptions, RetrieveRequest } from './request'
export type {
  RecipeTrace,
  RetrievalRecipe,
  RetrievalRecipeConfig,
  RetrievalRecipeGroundingConfig,
  RetrievalRecipeSource,
  StepTrace,
} from './recipe/recipe'
export type {
  PlannedQuery,
  RetrievalSourceTrace,
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
  RetrieverSource,
  RetrieverMode,
  RetrieverTools,
} from './types'
export type { RetrievalToolDef, RetrievalToolHit, RetrievalToolPayload } from './tools'
