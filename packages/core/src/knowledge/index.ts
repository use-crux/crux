/**
 * Connected knowledge public entrypoint.
 *
 * Start with {@link knowledgeBase} for knowledge indexing and retrieval, then
 * compose connected knowledge contracts as they become available.
 *
 * @module
 */

export { knowledgeBase } from '../retrieval/knowledge-base'
export { assertions } from './assertions/assertions'
export { communities } from './communities/communities'
export { runConnectedKnowledgeConformance } from './conformance'
export { knowledgeModel } from './model'
export { relate } from './relate/relate'
export { relateEntities } from './relate/entities'
export { relateReferences } from './relate/references'

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
export type {
  CommunitiesConfig,
  CommunitiesFactoryConfig,
} from './communities/communities'
export type {
  ConnectedKnowledgeConformanceAssertion,
  ConnectedKnowledgeConformanceExpect,
  ConnectedKnowledgeConformanceTest,
  RunConnectedKnowledgeConformanceOptions,
} from './conformance'
export type {
  CommunityBuildDescriptor,
  CommunityReadinessStatus,
  CommunityRefreshHost,
  CommunityReportsOptions,
  CommunityReportsPage,
  KnowledgeCommunitiesSurface,
} from './communities/lifecycle'
export type {
  CommunityReport,
  CommunityReportCounts,
  CommunityReportFinding,
  CommunityReportLineage,
} from './communities/records'
export type { AssertionDeriveStage, BaseDeriveStage, DeriveStage, RelationDeriveStage } from './derive/stage'
export type {
  AssertionEmitApi,
  AssertionEmitOptions,
  AssertionRelateOptions,
  AssertionRelationEndpoint,
  AssertionOf,
  AssertionRun,
  AssertionRunInput,
  AssertionStage,
  AssertionsConfig,
} from './assertions/assertions'
export type { AssertionSupport, KnowledgeAssertionRecord } from './assertions/identity'
export type { AssertionContextOptions } from './assertions/context'
export type {
  AssertionListOptions,
  AssertionListPage,
  AssertionSet,
  AssertionSetOptions,
} from './assertions/set'
export type {
  AssertionDecisionEvidence,
  AssertionPolicyDecision,
  AssertionPolicyInput,
  AssertionResolutionHandle,
  AssertionResolutionPolicy,
  AssertionResolutionResult,
  AssertionResolutionStatus,
  AssertionResolutionTrace,
} from './assertions/resolution'
export type {
  AssertionIdentityRefInput,
  AssertionRef,
  AssertionRelationRecord,
  AssertionRelationType,
} from './assertions/relations'
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
export type {
  KnowledgeBaseViewConfig,
  KnowledgeView,
  KnowledgeViewInspection,
  KnowledgeViewRecipeConfig,
  KnowledgeViewResolution,
  KnowledgeViewRetrieverConfig,
} from './view/view'
export type { ViewWhere, WhereClause } from './view/where'
