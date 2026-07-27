/**
 * Canonical structured-timeout error identity.
 *
 * @module
 */

import type { TimeoutBudget, TimeoutErrorOptions } from "./timeout-options";

const TIMEOUT_ERROR_MARKER = Symbol.for("@use-crux/core/TimeoutError");

/**
 * Typed failure emitted by Crux-managed timeout budgets.
 *
 * @remarks
 * Catch this error when you need to branch on the budget that expired.
 * Provider-native timeout errors remain provider-owned and are not canonical
 * Crux timeout errors.
 *
 * @example
 * ```ts
 * import { TimeoutError } from '@use-crux/core'
 *
 * try {
 *   await run()
 * } catch (error) {
 *   if (TimeoutError.isInstance(error)) {
 *     console.error(error.budget, error.limitMs)
 *   }
 * }
 * ```
 */
export class TimeoutError extends Error {
  override readonly name = "TimeoutError";
  /** Budget that expired. */
  readonly budget: TimeoutBudget;
  /** Millisecond limit that was exceeded. */
  readonly limitMs: number;
  /** Tool name when the expired budget is Tool-specific. */
  readonly toolName?: string;

  /**
   * Create a canonical Crux timeout error.
   *
   * @param options - Expired budget metadata.
   */
  constructor(options: TimeoutErrorOptions) {
    const subject = options.toolName ? ` for tool "${options.toolName}"` : "";
    super(`${options.budget} timeout${subject} exceeded ${options.limitMs}ms`);
    Object.defineProperty(this, TIMEOUT_ERROR_MARKER, { value: true });
    this.budget = options.budget;
    this.limitMs = options.limitMs;
    if (options.toolName !== undefined) this.toolName = options.toolName;
  }

  /**
   * Check whether a value is a canonical Crux timeout error.
   *
   * @remarks
   * Recognizes errors created by another installed copy of `@use-crux/core`.
   * An ordinary error whose `name` is `"TimeoutError"` is not canonical.
   *
   * @param value - Candidate value to classify.
   * @returns `true` when the value carries Crux's canonical timeout identity.
   *
   * @example
   * ```ts
   * import { TimeoutError } from '@use-crux/core'
   *
   * if (TimeoutError.isInstance(error)) {
   *   retryAfter(error.limitMs)
   * }
   * ```
   */
  static isInstance(value: unknown): value is TimeoutError {
    return (
      value instanceof TimeoutError ||
      (typeof value === "object" &&
        value !== null &&
        Reflect.get(value, TIMEOUT_ERROR_MARKER) === true)
    );
  }
}
