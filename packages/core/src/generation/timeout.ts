/**
 * Structured timeout budgets for managed generation and streaming calls.
 *
 * Runtime code applies each budget at the seam it owns: whole call, provider
 * step, stream chunk inactivity, first token, or Tool execution.
 *
 * @module
 */

export { TimeoutError } from "./timeout-error";
export {
  Deadline,
  composeAbortSignals,
  createBudgetSignal,
  normalizeBudgetMs,
  toolBudgetMs,
  withAbortSignal,
  withBudget,
} from "./timeout-budget";
export {
  clampEvalTimeoutCeilingForInternalUse,
  isEvalTimeoutCeilingForInternalUse,
  markEvalTimeoutCeilingForInternalUse,
  resolveTimeoutOverrideForInternalUse,
} from "./timeout-ceiling";
export type {
  BudgetOptions,
  BudgetSignal,
  TimeoutBudget,
  TimeoutErrorOptions,
  TimeoutOptions,
} from "./timeout-options";
