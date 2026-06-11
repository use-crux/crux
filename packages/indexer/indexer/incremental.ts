export type {
  AbsoluteSourceFilePath,
  DependencyClosureReindexDecision,
  FullReindexReason,
  FullReindexRequiredDecision,
  GraphConfidence,
  IncrementalDecisionExplanation,
  IncrementalExecutionMode,
  IncrementalExecutionReport,
  IncrementalIndexDecision,
  IncrementalIndexExecutionResult,
  IndexProjectIncrementalOptions,
  IndexFilesOptions,
  SemanticClosureReindexDecision,
  SourceFileReindexDecision,
} from './incremental/index'
export {
  indexInvalidationFromDecision,
  explainIncrementalDecision,
  indexProjectIncremental,
  planIndexFiles,
  planIndexFilesDryRun,
} from './incremental/index'
