/**
 * Structured timeout budgets for managed generation and streaming calls.
 *
 * The public option is a budget object instead of one ambiguous millisecond
 * value. Runtime code applies each budget at the seam it owns: whole call,
 * provider step, stream chunk inactivity, or tool execution.
 *
 * @module
 */

/** Timeout budget names used by {@link TimeoutError}. */
export type TimeoutBudget = "total" | "step" | "chunk" | "tool";

/**
 * Timeout policy for a managed `generate()` or `stream()` call.
 *
 * All values are milliseconds. Non-positive, non-finite, or absent values
 * disable that budget. `tools[name]` overrides `toolMs` for one named tool.
 */
export interface TimeoutOptions {
  /** Whole managed call, including all model steps, retries, and tool execution. */
  readonly totalMs?: number;
  /** One provider/model step. */
  readonly stepMs?: number;
  /** Maximum inactivity gap between stream chunks. */
  readonly chunkMs?: number;
  /** Default budget for each tool execution. */
  readonly toolMs?: number;
  /** Per-tool execution budgets, keyed by tool name. */
  readonly tools?: Readonly<Record<string, number>>;
}

/** Options used to construct a {@link TimeoutError}. */
export interface TimeoutErrorOptions {
  /** Budget that expired. */
  readonly budget: TimeoutBudget;
  /** Millisecond limit that was exceeded. */
  readonly limitMs: number;
  /** Tool name when the expired budget is tool-specific. */
  readonly toolName?: string;
}

/**
 * Typed timeout failure emitted by Crux-managed timeout budgets.
 *
 * Catch this class when you need to branch on which budget fired. Provider
 * abort errors can still surface through `.raw`/`extra` SDK behavior; this
 * class is the canonical Crux timeout error.
 */
export class TimeoutError extends Error {
  override readonly name = "TimeoutError";
  readonly budget: TimeoutBudget;
  readonly limitMs: number;
  readonly toolName?: string;

  constructor(options: TimeoutErrorOptions) {
    const subject = options.toolName ? ` for tool "${options.toolName}"` : "";
    super(`${options.budget} timeout${subject} exceeded ${options.limitMs}ms`);
    this.budget = options.budget;
    this.limitMs = options.limitMs;
    if (options.toolName !== undefined) this.toolName = options.toolName;
  }
}

/** Metadata for one timeout budget, active only when `limitMs` is positive. */
export interface BudgetOptions {
  /** Budget to enforce. */
  readonly budget: TimeoutBudget;
  /** Millisecond limit. Non-positive, non-finite, or absent values disable the budget. */
  readonly limitMs?: number;
  /** Tool name when the budget is tool-specific. */
  readonly toolName?: string;
}

/** Disposable abort signal for APIs that support cooperative cancellation. */
export interface BudgetSignal {
  /** Abort signal that receives a {@link TimeoutError} as its reason. */
  readonly signal: AbortSignal | undefined;
  /** Reset the timer from now, if the budget is still active. */
  refresh(): void;
  /** Clear the timer. */
  dispose(): void;
}

/**
 * Shared hard deadline for one managed operation.
 *
 * A `Deadline` represents the outer timeout wall for a routed call. It always
 * exposes an {@link AbortSignal}, even when no finite budget is configured, so
 * routing code can compose it with narrower attempt-level signals without
 * special casing the no-timeout path.
 */
export class Deadline {
  readonly #controller: AbortController;
  readonly #limitMs: number | undefined;
  readonly #expiresAt: number | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  private constructor(limitMs: number | undefined) {
    this.#controller = new AbortController();
    this.#limitMs = limitMs;
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
   * @param totalMs - Whole-operation budget in milliseconds. Non-positive,
   *   non-finite, or absent values create an open deadline.
   */
  static after(totalMs: number | undefined): Deadline {
    return new Deadline(normalizeBudgetMs(totalMs));
  }

  /** Signal that aborts when the total deadline expires. */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /**
   * Milliseconds remaining before expiry.
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
   * The returned signal aborts with the first reason from either source. When
   * no attempt signal is supplied, the deadline signal itself is returned.
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
 * Passing a signal to a provider is cooperative; this helper also rejects the
 * local promise when that signal fires so routing budgets make progress even
 * when a provider ignores cancellation.
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
 * Return a normalized positive millisecond budget.
 *
 * @param limitMs - Candidate budget.
 * @returns A floored positive millisecond value, or `undefined` when disabled.
 */
export function normalizeBudgetMs(
  limitMs: number | undefined,
): number | undefined {
  if (typeof limitMs !== "number" || !Number.isFinite(limitMs) || limitMs <= 0)
    return undefined;
  return Math.floor(limitMs);
}

/**
 * Resolve the effective tool budget for a named tool.
 *
 * @param timeout - Structured timeout policy.
 * @param toolName - Tool being executed.
 * @returns The per-tool override, then the default tool budget, normalized.
 */
export function toolBudgetMs(
  timeout: TimeoutOptions | undefined,
  toolName: string,
): number | undefined {
  return normalizeBudgetMs(timeout?.tools?.[toolName] ?? timeout?.toolMs);
}

/**
 * Create an abort signal backed by one timeout budget.
 *
 * The returned signal is useful for SDKs with cooperative cancellation. Code
 * still needs to await or race the operation to observe the error promptly;
 * use {@link withBudget} when the operation does not accept a signal.
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
 * @returns The operation result, or rejects with {@link TimeoutError}.
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
