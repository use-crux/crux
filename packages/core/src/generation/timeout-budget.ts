/**
 * Runtime helpers for structured timeout budgets and cancellation.
 *
 * @module
 */

import { TimeoutError } from "./timeout-error";
import type {
  BudgetOptions,
  BudgetSignal,
  TimeoutOptions,
} from "./timeout-options";

/**
 * Shared hard deadline for one managed operation.
 *
 * @remarks
 * A `Deadline` represents the outer timeout wall for a routed call. It always
 * exposes an {@link AbortSignal}, even when no finite budget is configured, so
 * routing code can compose it with narrower attempt-level signals without
 * special-casing the no-timeout path.
 */
export class Deadline {
  readonly #controller: AbortController;
  readonly #expiresAt: number | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  private constructor(limitMs: number | undefined) {
    this.#controller = new AbortController();
    this.#expiresAt = limitMs === undefined ? undefined : Date.now() + limitMs;

    if (limitMs !== undefined) {
      this.#timer = setTimeout(() => {
        this.#controller.abort(new TimeoutError({ budget: "total", limitMs }));
      }, limitMs);
    }
  }

  /**
   * Create a deadline from a total timeout budget.
   *
   * @param totalMs - Whole-operation budget in milliseconds. Missing, `null`,
   *   non-positive, or non-finite values create an open deadline.
   * @returns A deadline whose signal expires after the normalized budget.
   */
  static after(totalMs: number | null | undefined): Deadline {
    return new Deadline(normalizeBudgetMs(totalMs));
  }

  /** Signal that aborts when the total deadline expires. */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /**
   * Read the time remaining before expiry.
   *
   * @returns `undefined` for open deadlines, otherwise a non-negative integer.
   */
  remaining(): number | undefined {
    if (this.#expiresAt === undefined) return undefined;
    return Math.max(0, this.#expiresAt - Date.now());
  }

  /**
   * Compose this deadline with a narrower attempt signal.
   *
   * @param attemptSignal - Optional attempt-owned cancellation signal.
   * @returns A signal that aborts with the first reason from either source.
   */
  compose(attemptSignal: AbortSignal | undefined): AbortSignal {
    return composeAbortSignals(this.signal, attemptSignal) ?? this.signal;
  }

  /** Clear the deadline timer after the operation settles. */
  dispose(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

/**
 * Compose optional abort signals, preserving the first abort reason.
 *
 * @param signals - Candidate signals ordered from broadest to narrowest.
 * @returns A signal that aborts when any supplied signal aborts, or
 *   `undefined` when no signals were supplied.
 */
export function composeAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const active = signals.filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

/**
 * Race an async operation against an abort signal.
 *
 * @remarks
 * Passing a signal to a provider is cooperative. This helper also rejects the
 * local promise when that signal fires, so routing can make progress when a
 * provider ignores cancellation.
 *
 * @param fn - Operation to start.
 * @param signal - Optional cancellation signal.
 * @returns The operation result.
 * @throws The operation failure, or the signal's reason when cancellation wins the race.
 */
export async function withAbortSignal<T>(
  fn: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return fn();
  if (signal.aborted) throw signal.reason;

  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Normalize a candidate millisecond budget.
 *
 * @param limitMs - Candidate budget.
 * @returns A floored positive millisecond value, or `undefined` when disabled.
 */
export function normalizeBudgetMs(
  limitMs: number | null | undefined,
): number | undefined {
  if (typeof limitMs !== "number" || !Number.isFinite(limitMs) || limitMs <= 0)
    return undefined;
  return Math.floor(limitMs);
}

/**
 * Resolve the effective Tool budget for a named Tool.
 *
 * @remarks
 * A present named value has precedence over `toolMs`. This includes `null`,
 * which explicitly disables the named Tool budget. An absent name inherits
 * `toolMs`.
 *
 * @param timeout - Structured timeout policy.
 * @param toolName - Tool being executed.
 * @returns The normalized named or default Tool budget.
 */
export function toolBudgetMs(
  timeout: TimeoutOptions | undefined,
  toolName: string,
): number | undefined {
  const namedTools = timeout?.tools;
  return normalizeBudgetMs(
    namedTools !== undefined && Object.hasOwn(namedTools, toolName)
      ? namedTools[toolName]
      : timeout?.toolMs,
  );
}

/**
 * Create an abort signal backed by one timeout budget.
 *
 * @remarks
 * The returned signal supports cooperative cancellation. Code must still await
 * or race the operation to observe the error promptly; use {@link withBudget}
 * when the operation does not accept a signal.
 *
 * @param options - Budget metadata and millisecond limit.
 * @returns A disposable signal controller, or an inert controller when disabled.
 */
export function createBudgetSignal(
  options: BudgetOptions | undefined,
): BudgetSignal {
  const limitMs = normalizeBudgetMs(options?.limitMs);
  if (!options || limitMs === undefined) {
    return { signal: undefined, refresh: () => {}, dispose: () => {} };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = (): void => {
    if (controller.signal.aborted) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new TimeoutError({ ...options, limitMs })),
      limitMs,
    );
  };

  arm();

  return {
    signal: controller.signal,
    refresh: arm,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/**
 * Run an async operation against one timeout budget.
 *
 * @param fn - Operation to run. Receives a cooperative abort signal when a
 *   budget is active.
 * @param options - Budget metadata and millisecond limit.
 * @returns The operation result.
 * @throws {TimeoutError} When the normalized budget expires first.
 * @throws The operation failure when `fn` rejects before the budget expires.
 */
export async function withBudget<T>(
  fn: (signal: AbortSignal | undefined) => Promise<T>,
  options: BudgetOptions | undefined,
): Promise<T> {
  const limitMs = normalizeBudgetMs(options?.limitMs);
  if (!options || limitMs === undefined) return fn(undefined);

  const budget = createBudgetSignal({ ...options, limitMs });
  try {
    return await Promise.race([
      fn(budget.signal),
      new Promise<never>((_, reject) => {
        budget.signal?.addEventListener(
          "abort",
          () => {
            reject(
              budget.signal?.reason ??
                new TimeoutError({ ...options, limitMs }),
            );
          },
          { once: true },
        );
      }),
    ]);
  } finally {
    budget.dispose();
  }
}
