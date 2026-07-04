/**
 * Convex runtime profile for `@use-crux/core/retrieval`.
 *
 * This subpath mirrors the core Retrieval & RAG beta API. `knowledgeBase()`
 * and store-backed `retriever()` can late-bind the active Convex Crux storage;
 * recipes and step builders are identical core re-exports.
 *
 * @module
 */

import {
  knowledgeBase as coreKnowledgeBase,
  retriever as coreRetriever,
} from '@use-crux/core/retrieval'
import type { z } from 'zod'
import type { Storage } from '@use-crux/core/storage'
import type { KnowledgeBase, KnowledgeBaseConfig, Retriever } from '@use-crux/core/retrieval'
import { convexRuntimeStorage } from './runtime'

export {
  compressToBudget,
  expandParents,
  fanout,
  grounding,
  isRetrievalToolPayload,
  rerank,
  retrievalRecipe,
  retrievalStep,
  retrieve,
  RETRIEVAL_HITS_KIND,
  rewriteQuery,
  RetrievalConfigError,
  RetrievalNotImplementedError,
  RetrievalRunError,
} from '@use-crux/core/retrieval'

export type {
  Grounding,
  KnowledgeBase,
  KnowledgeBaseConfig,
  KnowledgeBaseInspection,
  KnowledgeBaseScopeConfig,
  MetadataFilter,
  PlannedQuery,
  RecipeTrace,
  RetrievalConfigErrorCode,
  RetrievalInjectMode,
  RetrievalModel,
  RetrievalRecipe,
  RetrievalRecipeConfig,
  RetrievalRecipeSource,
  RetrievalRunErrorCode,
  RetrievalSourceTrace,
  RetrievalStep,
  RetrievalStepConfig,
  RetrievalStepContext,
  RetrievalStepKind,
  RetrievalToolConfig,
  RetrievalToolDef,
  RetrievalToolHit,
  RetrievalToolName,
  RetrievalToolPayload,
  RetrieveOptions,
  RetrieveRequest,
  Retriever,
  RetrieverHit,
  RetrieverMode,
  RetrieverTools,
  ScopedKnowledgeBase,
  StepInput,
  StepOutput,
  StepPhase,
  StepTrace,
} from '@use-crux/core/retrieval'

/** Convex profile config for `knowledgeBase()`, defaulting storage from runtime. */
export type ConvexKnowledgeBaseConfig<TMetadataSchema extends z.ZodType<unknown> | undefined = undefined> =
  KnowledgeBaseConfig<TMetadataSchema> & {
    /** Explicit storage override. Defaults to the active Convex Crux runtime storage. */
    readonly storage?: Storage
  }

type CoreRetrieverConfig = Parameters<typeof coreRetriever>[0]

/** Create a knowledge base that defaults to active Convex runtime storage. */
export function knowledgeBase<const TMetadataSchema extends z.ZodType<unknown> | undefined = undefined>(
  config: ConvexKnowledgeBaseConfig<TMetadataSchema>,
): KnowledgeBase<TMetadataSchema> {
  return coreKnowledgeBase({
    ...config,
    storage: config.storage ?? convexRuntimeStorage,
  })
}

/** Create a retriever, late-binding Convex runtime storage for store-backed configs. */
export function retriever(config: CoreRetrieverConfig): Retriever {
  if (isCustomRetrieverConfig(config)) {
    return coreRetriever(config)
  }
  return coreRetriever({
    ...config,
    storage: config.storage ?? convexRuntimeStorage,
  })
}

function isCustomRetrieverConfig(
  config: CoreRetrieverConfig,
): config is Extract<CoreRetrieverConfig, { readonly retrieve: unknown }> {
  return 'retrieve' in config
}
