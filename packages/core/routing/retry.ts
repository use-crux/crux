/**
 * Retry routing wrapper.
 *
 * `retry()` retries the same child model on qualifying provider failures before
 * letting the error escape to an outer fallback or caller.
 *
 * @module
 */

import type {
  BoundOf,
  CtxOf,
  InOf,
  RoutingPhantom,
  StreamOf,
} from "./types";
import type { ErrorCategory } from "../generation/fallback";

/** Backoff policy between retry attempts. */
export type RetryBackoff = "none" | "linear" | "exponential";

/** Options for a retry wrapper. */
export interface RetryOptions {
  /** Stable id used to join authored index definitions with routing spans. */
  readonly id?: string;
  /** Human-readable description for index and devtools surfaces. */
  readonly description?: string;
  /** Total number of attempts, including the first try. */
  readonly attempts: number;
  /** Delay policy between failed attempts. @defaultValue "none" */
  readonly backoff?: RetryBackoff;
  /** Error categories that should be retried. Defaults to retryable categories. */
  readonly on?: readonly ErrorCategory[];
  /** Base delay for linear/exponential backoff. @defaultValue 250 */
  readonly delayMs?: number;
}

/** A retry model wrapper recognized by adapters via {@link isRetry}. */
export interface RetryModel<M = unknown>
  extends RoutingPhantom<InOf<M>, CtxOf<M>, StreamOf<M>, BoundOf<M>, never> {
  readonly _tag: "crux.retry";
  readonly model: M;
  readonly options: RetryOptions;
}

/**
 * Retry one model before surfacing a qualifying failure.
 *
 * @example
 * ```ts
 * const resilient = retry(gpt5, {
 *   attempts: 3,
 *   backoff: 'exponential',
 *   on: ['rate_limit', 'timeout'],
 * })
 * ```
 */
export function retry<M>(model: M, options: RetryOptions): RetryModel<M> {
  if (!Number.isInteger(options.attempts) || options.attempts < 1) {
    throw new Error("retry() requires attempts to be a positive integer");
  }

  return Object.freeze({
    _tag: "crux.retry" as const,
    model,
    options,
    __phantom: undefined as unknown as RetryModel<M>["__phantom"],
  });
}

/** Type guard for retry wrappers. */
export function isRetry(model: unknown): model is RetryModel {
  return (
    model !== null &&
    model !== undefined &&
    typeof model === "object" &&
    "_tag" in model &&
    (model as { _tag: unknown })._tag === "crux.retry"
  );
}
