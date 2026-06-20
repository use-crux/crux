export type { IndexProjectOptions, IndexProjectRuntimeOptions } from './indexer/index'
export type { ProjectModelResolutionMode } from '@crux/core/project-index'
export { indexProject, indexProjectAst, indexProjectRuntime, indexProjectSemantic } from './indexer/index'
export type { ResolveProjectModelOptions } from './indexer/project-model'
export { resolveProjectModel } from './indexer/project-model'
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
export {
  astIndexPatchFromCompilerResult,
  compileProjectIndex,
  createProjectIndexCompiler,
  projectIndexSnapshotFromCompilerResult,
  runtimeIndexPatchFromCompilerResult,
} from './indexer/compiler'
export type {
  ProjectIndexCompiler,
  ProjectIndexCompileMode,
  ProjectIndexCompilerInput,
  ProjectIndexCompilerResult,
} from './indexer/compiler'
export type { CompilerOwnedProjection, ProjectIndexCompilerProfile } from './indexer/compiler/profile'
export { createStaticExtraction } from './indexer/static/extraction/engine'
export type {
  SourceReader,
  StaticExtractionEngine,
  StaticExtractionOptions,
  StaticFileExtraction,
  StaticParseCacheStore,
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
  SemanticAnalyzeInput,
  SemanticAnalyzeResult,
  SemanticBackend,
  SemanticBackendCapabilities,
  SemanticBackendIdentity,
  SemanticBackendName,
  SemanticBackendOption,
  SemanticBackendSelection,
  SemanticBackendSelectionEnv,
  SemanticBackendSession,
  SemanticBackendSessionInput,
  SemanticCompilerDeclaration,
  SemanticCompilerNode,
  SemanticCompilerSourceFile,
  SemanticCompilerSymbol,
  SemanticCompilerType,
  SemanticCompilerView,
  SemanticEvidenceBatch,
  SemanticEvidenceBatchKind,
  SemanticEvidenceBatchSource,
  SemanticSourceProfile,
  SemanticSourceProfileFile,
  SemanticSourceProfileHints,
  NativeSemanticBackendSelection,
  TypeScriptSemanticBackendSelection,
} from './indexer/semantic/service'
export {
  builtInRelationPolicies,
  createRelationPolicyTable,
  mergeRelationsByIdentity,
  relationDiagnosticsFromReport,
  relationIdentity,
  resolveRelationModel,
  withResolvedRelationReadModel,
} from './indexer/relations/index'
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
} from './indexer/relations/index'
