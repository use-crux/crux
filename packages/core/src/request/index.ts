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
} from "./receipt/receipt";
export type {
  RequestTokenBreakdown,
  RequestTokenBreakdownEntry,
} from "./measure/breakdown";
export {
  history,
  type HistoryFactory,
} from "./history/recent";
export type {
  RecentHistoryOptions,
  RecentHistoryProjection,
} from "./history/source";
