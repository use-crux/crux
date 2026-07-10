export type {
  AbsoluteSourceFilePath,
  DependencyClosureReindexDecision,
  FullReindexReason,
  FullReindexRequiredDecision,
  GraphConfidence,
  IncrementalDecisionExplanation,
  IncrementalIndexDecision,
  IncrementalSourceHashEvidence,
  IndexFilesOptions,
  SemanticClosureReindexDecision,
  SourceFileReindexDecision,
} from './types'
export { explainIncrementalDecision } from './explain'
export { indexInvalidationFromDecision, type IndexPatchInvalidation } from './invalidation'
export { planIndexFiles } from './plan'
export { planIndexFilesDryRun } from './dry-run'
export type {
  IncrementalExecutionReport,
  IncrementalPatchCounts,
  IncrementalSemanticStatus,
} from './execution-types'
