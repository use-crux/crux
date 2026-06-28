/**
 * Retrieval: queryable knowledge sources, rerankers, and multi-stage pipelines.
 *
 * Build a {@link retriever} over a vector/data store (or a custom function),
 * compose {@link reranker}s, and wrap it in a {@link retrievalPipeline} with
 * query- and hit-phase {@link retrievalStage}s such as {@link queryPlanner},
 * {@link multiQuery}, {@link parentExpand}, {@link compress}, {@link diversify},
 * and {@link decay}.
 *
 * @module
 */

export { retriever } from './define-retriever'
export { reranker } from './reranker'
export { retrievalStage } from './stage'
export { retrievalPipeline } from './pipeline'
export { queryPlanner, multiQuery, parentExpand, compress, diversify, decay } from './built-in-stages'

export type {
  HitRetrievalStage,
  HitStageInput,
  PlannedRetrievalQuery,
  QueryRetrievalStage,
  QueryStageInput,
  RerankerInput,
  RetrievalInjectMode,
  RetrievalPipeline,
  RetrievalPipelineStage,
  RetrievalPipelineTrace,
  RetrievalStageKind,
  RetrievalStagePhase,
  RetrievalStagePreview,
  RetrievalStageTrace,
  RetrievalToolConfig,
  RetrievalToolName,
  Retriever,
  RetrieverHit,
  RetrieverMode,
  RetrieverReranker,
  RetrieverTools,
  RetrieveOptions,
} from './types'
