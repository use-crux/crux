/**
 * Connected knowledge public entrypoint.
 *
 * Start with {@link knowledgeBase} for knowledge indexing and retrieval, then
 * compose connected knowledge contracts as they become available.
 *
 * @module
 */

export { knowledgeBase } from '../retrieval/knowledge-base'

export type {
  KnowledgeBase,
  KnowledgeBaseConfig,
  KnowledgeBaseFilter,
  KnowledgeBaseGroundingConfig,
  KnowledgeBaseInspection,
  KnowledgeBaseRecipeConfig,
  KnowledgeBaseRetrieverConfig,
  KnowledgeBaseScopeConfig,
  ScopedKnowledgeBase,
} from '../retrieval/knowledge-base'
export type { AssertionDeriveStage, BaseDeriveStage, DeriveStage, RelationDeriveStage } from './derive/stage'
export {
  decodeKnowledgeRef,
  encodeKnowledgeRef,
  isKnowledgeRef,
  isKnowledgeRefKind,
} from './refs'
export type { KnowledgeRef, KnowledgeRefKind } from './refs'
export type { KnowledgeGraphReader, KnowledgeNeighbor, StructuralRelationType } from './graph-types'
