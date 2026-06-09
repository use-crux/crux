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
