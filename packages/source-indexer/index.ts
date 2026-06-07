export type { IndexProjectOptions } from './indexer/index'
export { indexProject, indexProjectAst, indexProjectSemantic } from './indexer/index'
export { indexProjectIncremental } from './indexer/incremental'
export {
  astCatalogPatchFromCompilerResult,
  compileProjectCatalog,
  projectCatalogSnapshotFromCompilerResult,
} from './indexer/compiler'
export type {
  ProjectCatalogCompileMode,
  ProjectCatalogCompilerInput,
  ProjectCatalogCompilerResult,
} from './indexer/compiler'
export type {
  IncrementalExecutionMode,
  IncrementalExecutionReport,
  IncrementalIndexExecutionResult,
  IndexProjectIncrementalOptions,
} from './indexer/incremental'
export type { CatalogPatch, CatalogPatchBudget, CatalogPatchFacts, CatalogPatchPhase, CatalogPatchStatus } from './indexer/patches'
