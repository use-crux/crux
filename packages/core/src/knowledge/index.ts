/**
 * Connected knowledge public entrypoint.
 *
 * Start with {@link knowledgeBase} for knowledge indexing and retrieval, then
 * compose connected knowledge contracts as they become available.
 *
 * @module
 */

export { knowledgeBase } from '../retrieval/knowledge-base'
export { knowledgeModel } from './model'
export { relate } from './relate/relate'

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
export type { KnowledgeModel, KnowledgeModelConfig } from './model'
export type {
  KnowledgeLocator,
  RelateConfig,
  RelateEmitApi,
  RelateEmitOptions,
  RelateRun,
  RelateRunInput,
  RelationStage,
  RelationTypeSpec,
} from './relate/relate'
export {
  decodeKnowledgeRef,
  encodeKnowledgeRef,
  isKnowledgeRef,
  isKnowledgeRefKind,
} from './refs'
export type { KnowledgeRef, KnowledgeRefKind } from './refs'
export type { KnowledgeGraphReader, KnowledgeNeighbor, StructuralRelationType } from './graph-types'
