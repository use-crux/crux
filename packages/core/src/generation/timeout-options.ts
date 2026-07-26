/**
 * Public structured-timeout option and metadata types.
 *
 * @module
 */

/** Timeout budget names used by canonical Crux timeout errors. */
export type TimeoutBudget = "total" | "step" | "chunk" | "tool" | "firstToken";

/**
 * Timeout policy for a managed `generate()` or `stream()` call.
 *
 * @remarks
 * All values are milliseconds. Missing values and `null` disable the
 * corresponding budget, as do non-positive and non-finite numbers.
 * A present `tools[name]` replaces `toolMs` for that named Tool, including
 * when the named value is `null`.
 *
 * @example
 * ```ts
 * import type { TimeoutOptions } from '@use-crux/core'
 *
 * const timeout = {
 *   totalMs: 30_000,
 *   toolMs: 5_000,
 *   tools: { search: null },
 * } satisfies TimeoutOptions
 * ```
 */
export interface TimeoutOptions {
  /** Whole managed call, including all model steps, retries, and Tool execution. */
  readonly totalMs?: number | null;
  /** One provider or model step. */
  readonly stepMs?: number | null;
  /** Maximum inactivity gap between stream chunks. */
  readonly chunkMs?: number | null;
  /** Maximum time to the first emitted stream token. */
  readonly firstToken?: number | null;
  /** Default budget for each Tool execution. */
  readonly toolMs?: number | null;
  /** Per-Tool execution budgets keyed by Tool name. */
  readonly tools?: Readonly<Record<string, number | null>>;
}

/** Options used to construct a canonical Crux timeout error. */
export interface TimeoutErrorOptions {
  /** Budget that expired. */
  readonly budget: TimeoutBudget;
  /** Millisecond limit that was exceeded. */
  readonly limitMs: number;
  /** Tool name when the expired budget is Tool-specific. */
  readonly toolName?: string;
}

/** Metadata for one timeout budget. */
export interface BudgetOptions {
  /** Budget to enforce. */
  readonly budget: TimeoutBudget;
  /** Millisecond limit. Missing, `null`, non-positive, or non-finite values disable it. */
  readonly limitMs?: number | null;
  /** Tool name when the budget is Tool-specific. */
  readonly toolName?: string;
}

/** Disposable abort signal for APIs that support cooperative cancellation. */
export interface BudgetSignal {
  /** Abort signal that receives the canonical timeout error as its reason. */
  readonly signal: AbortSignal | undefined;
  /** Reset the timer from now when the budget is active. */
  refresh(): void;
  /** Clear the timer. */
  dispose(): void;
}
