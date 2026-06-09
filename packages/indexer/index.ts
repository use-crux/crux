export type { IndexProjectOptions } from './indexer/index'
export { indexProject, indexProjectAst, indexProjectSemantic } from './indexer/index'
export { indexProjectIncremental } from './indexer/incremental'
export {
  astIndexPatchFromCompilerResult,
  compileProjectIndex,
  createProjectIndexCompiler,
  projectIndexSnapshotFromCompilerResult,
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
  IndexProjectIncrementalOptions,
} from './indexer/incremental'
export type {
  IndexPatch,
  IndexPatchBudget,
  IndexPatchFacts,
  IndexPatchPhase,
  IndexPatchStatus,
} from './indexer/patches'
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
  RelationFactRef,
  RelationModel,
  RelationModelInput,
  RelationPolicyTable,
  RelationResolutionReport,
  UnresolvedRelationReason,
  UnresolvedRelationRef,
} from './indexer/relations/index'
