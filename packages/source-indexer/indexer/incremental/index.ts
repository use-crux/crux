export type {
  AbsoluteSourceFilePath,
  DependencyClosureReindexDecision,
  FullReindexReason,
  FullReindexRequiredDecision,
  GraphConfidence,
  IncrementalDecisionExplanation,
  IncrementalIndexDecision,
  IndexFilesOptions,
  SemanticClosureReindexDecision,
  SourceFileReindexDecision,
} from './types'
export { explainIncrementalDecision } from './explain'
export { catalogInvalidationFromDecision, type CatalogPatchInvalidation } from './invalidation'
export { planIndexFiles } from './plan'
export { planIndexFilesDryRun } from './dry-run'
export { indexProjectIncremental } from './executor'
export type {
  IncrementalExecutionMode,
  IncrementalExecutionReport,
  IncrementalIndexExecutionResult,
  IndexProjectIncrementalOptions,
} from './execution-types'
