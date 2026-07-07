export type {
  AbsoluteSourceFilePath,
  DependencyClosureReindexDecision,
  FullReindexReason,
  FullReindexRequiredDecision,
  GraphConfidence,
  IncrementalDecisionExplanation,
  IncrementalExecutionReport,
  IncrementalIndexDecision,
  IncrementalPatchCounts,
  IncrementalSemanticStatus,
  IndexFilesOptions,
  SemanticClosureReindexDecision,
  SourceFileReindexDecision,
} from './incremental/index'
export {
  indexInvalidationFromDecision,
  explainIncrementalDecision,
  planIndexFiles,
  planIndexFilesDryRun,
} from './incremental/index'
