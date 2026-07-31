/**
 * Public context-planning contracts.
 *
 * @module
 */

export {
  RequestCompositionError,
  type RequestCompositionErrorCode,
  type RequestDiagnostic,
} from "./errors";
export {
  mergeInputBudget,
  type InputBudget,
} from "./budget/input-budget";
export type {
  RequestAdaptation,
  RequestWarning,
} from "./receipt/adaptations";
export type {
  RequestInspection,
  RequestReceipt,
  RequestSupportReceipt,
} from "./receipt/receipt";
export type {
  RequestTokenBreakdown,
  RequestTokenBreakdownEntry,
} from "./measure/breakdown";
export {
  history,
  type HistoryFactory,
} from "./history/managed";
export {
  summarize,
  type SummarizeFactory,
  type SummarizeStrategy,
} from "./history/strategies";
export type {
  HistoryOptions,
  HistoryProjection,
  ManagedHistoryProjection,
  ManagedHistoryRecent,
  ManagedHistorySummaryOptions,
  ProviderHistorySummaryInput,
  ProviderHistorySummaryResult,
  RecentHistoryOptions,
  RecentHistoryProjection,
} from "./history/source";
export {
  droppable,
  offload,
  offloadable,
  prefer,
  summarizable,
} from "./representation/wrappers";
export type {
  DroppableLadder,
  ForcedOffload,
  OffloadableLadder,
  OffloadableOptions,
  PreferLadder,
  RepresentationLadder,
  RepresentationEntry,
  RepresentationSource,
  RepresentationSourceSchema,
  SummarizableLadder,
  SummarizableOptions,
  ToolOutputOffloadPolicy,
} from "./representation/ladder-types";
export type { OffloadReceipt } from "./offload/handle";
export {
  PreparationError,
  type PreparationErrorReason,
  type PrepareStep,
} from "./prepare/step";
export {
  ResourceReadError,
  type ControlReadable,
  type PreparationResources,
  type ResourceReadErrorReason,
} from "./prepare/resources";
export type {
  AmendableContextEntry,
  ContributorSelector,
  ExecutionAmendment,
} from "./prepare/amendment";
export type {
  PreparationAttemptStats,
  PreparationCoverage,
  PreparationModelCallStats,
  PreparationScopeStats,
  PreparationUsageStats,
  StepContext,
  StepPreparationStats,
  StepReason,
  StepToolHistoryEntry,
} from "./prepare/step-context";
export type { PreparationDecisionInspection } from "./prepare/journal";
