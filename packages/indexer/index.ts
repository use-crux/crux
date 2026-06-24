/**
 * Public Crux Indexer entry point.
 *
 * This barrel exposes the high-level compiler facades for building Project
 * Index snapshots, patches, project-model reads, config inspection, relation
 * policies, incremental execution reports, and host-visible timing data.
 * Low-level compiler, parser, semantic backend, and worker-host contracts live
 * behind explicit subpaths so this surface stays stable for SDK consumers.
 *
 * @module
 */

export type {
  IndexProjectAstFromSyntaxRecordProviderOptions,
  IndexProjectAstFromSyntaxRecordsOptions,
  IndexProjectOptions,
  IndexProjectRuntimeOptions,
} from './indexer'
export type { ProjectModelResolutionMode } from '@crux/core/project-index'
export {
  indexProject,
  indexProjectAst,
  indexProjectAstFromSyntaxRecordProvider,
  indexProjectAstFromSyntaxRecords,
  indexProjectRuntime,
  indexProjectSemantic,
} from './indexer'
export type { ResolveProjectModelOptions } from './indexer/project-model'
export { resolveProjectModel } from './indexer/project-model'
export type { InspectProjectStaticSyntaxPlanOptions, ProjectStaticSyntaxPlan } from './indexer/static-plan'
export { inspectProjectStaticSyntaxPlan } from './indexer/static-plan'
export type {
  InspectProjectNativeStaticConfigOptions,
  ProjectNativeStaticConfig,
  ProjectNativeStaticExtensionReference,
} from './indexer/native-static-inspect'
export { inspectProjectNativeStaticConfig } from './indexer/native-static-inspect'
export type {
  InspectProjectConfigOptions,
  ProjectConfigFileOrigin,
  ProjectConfigFileStatus,
  ProjectConfigInspect,
  ProjectConfigList,
  ProjectConfigOrigin,
  ProjectConfigSetting,
} from './indexer/project-config-inspect'
export { inspectProjectConfig } from './indexer/project-config-inspect'
export { indexProjectIncremental } from './indexer/incremental'
export type {
  StaticExtractionTiming,
  StaticExtractionTimingName,
} from './indexer/static/extraction/engine'
export type {
  IncrementalExecutionMode,
  IncrementalExecutionReport,
  IncrementalIndexExecutionResult,
  IncrementalPatchCounts,
  IncrementalSemanticStatus,
  IndexProjectIncrementalOptions,
} from './indexer/incremental'
export type {
  IndexPatch,
  IndexPatchBudget,
  IndexPatchFacts,
  IndexPatchPhase,
  IndexPatchStatus,
} from './indexer/patches'
export type {
  SemanticBackendName,
  SemanticBackendSelection,
  SemanticSourceProfile,
  SemanticSourceProfileFile,
  SemanticSourceProfileHints,
  NativeSemanticBackendSelection,
  TypeScriptSemanticBackendSelection,
} from './indexer/semantic/service'
export type {
  SemanticIndexInstrumentation,
  SemanticIndexTiming,
  SemanticIndexTimingName,
} from './indexer/semantic/instrumentation'
export {
  builtInRelationPolicies,
  createRelationPolicyTable,
  mergeRelationsByIdentity,
  relationDiagnosticsFromReport,
  relationIdentity,
  resolveRelationModel,
  withResolvedRelationReadModel,
} from './indexer/relations'
export type {
  IndexRelationPolicy,
  IndexRelationPresentation,
  RelationFactRef,
  RelationModel,
  RelationModelInput,
  RelationPolicyTable,
  RelationResolutionReport,
  UnresolvedRelationReason,
  UnresolvedRelationRef,
} from './indexer/relations'
