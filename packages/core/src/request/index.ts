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
