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
export type TimeoutBudget = 'total' | 'step' | 'chunk' | 'tool'

/**
 * Timeout policy for a managed `generate()` or `stream()` call.
 *
 * All values are milliseconds. Non-positive, non-finite, or absent values
 * disable that budget. `tools[name]` overrides `toolMs` for one named tool.
 */
export interface TimeoutOptions {
  /** Whole managed call, including all model steps, retries, and tool execution. */
  readonly totalMs?: number
  /** One provider/model step. */
  readonly stepMs?: number
  /** Maximum inactivity gap between stream chunks. */
  readonly chunkMs?: number
  /** Default budget for each tool execution. */
  readonly toolMs?: number
  /** Per-tool execution budgets, keyed by tool name. */
  readonly tools?: Readonly<Record<string, number>>
}

/** Options used to construct a {@link TimeoutError}. */
export interface TimeoutErrorOptions {
  /** Budget that expired. */
  readonly budget: TimeoutBudget
  /** Millisecond limit that was exceeded. */
  readonly limitMs: number
  /** Tool name when the expired budget is tool-specific. */
  readonly toolName?: string
}

/**
 * Typed timeout failure emitted by Crux-managed timeout budgets.
 *
 * Catch this class when you need to branch on which budget fired. Provider
 * abort errors can still surface through `.raw`/`extra` SDK behavior; this
 * class is the canonical Crux timeout error.
 */
export class TimeoutError extends Error {
  override readonly name = 'TimeoutError'
  readonly budget: TimeoutBudget
  readonly limitMs: number
  readonly toolName?: string

  constructor(options: TimeoutErrorOptions) {
    const subject = options.toolName ? ` for tool "${options.toolName}"` : ''
    super(`${options.budget} timeout${subject} exceeded ${options.limitMs}ms`)
    this.budget = options.budget
    this.limitMs = options.limitMs
    if (options.toolName !== undefined) this.toolName = options.toolName
  }
}

/** Metadata for one timeout budget, active only when `limitMs` is positive. */
export interface BudgetOptions {
  /** Budget to enforce. */
  readonly budget: TimeoutBudget
  /** Millisecond limit. Non-positive, non-finite, or absent values disable the budget. */
  readonly limitMs?: number
  /** Tool name when the budget is tool-specific. */
  readonly toolName?: string
}

/** Disposable abort signal for APIs that support cooperative cancellation. */
export interface BudgetSignal {
  /** Abort signal that receives a {@link TimeoutError} as its reason. */
  readonly signal: AbortSignal | undefined
  /** Reset the timer from now, if the budget is still active. */
  refresh(): void
  /** Clear the timer. */
  dispose(): void
}

/**
 * Return a normalized positive millisecond budget.
 *
 * @param limitMs - Candidate budget.
 * @returns A floored positive millisecond value, or `undefined` when disabled.
 */
export function normalizeBudgetMs(limitMs: number | undefined): number | undefined {
  if (typeof limitMs !== 'number' || !Number.isFinite(limitMs) || limitMs <= 0) return undefined
  return Math.floor(limitMs)
}

/**
 * Resolve the effective tool budget for a named tool.
 *
 * @param timeout - Structured timeout policy.
 * @param toolName - Tool being executed.
 * @returns The per-tool override, then the default tool budget, normalized.
 */
export function toolBudgetMs(timeout: TimeoutOptions | undefined, toolName: string): number | undefined {
  return normalizeBudgetMs(timeout?.tools?.[toolName] ?? timeout?.toolMs)
}

/**
 * Create an abort signal backed by one timeout budget.
 *
 * The returned signal is useful for SDKs with cooperative cancellation. Code
 * still needs to await or race the operation to observe the error promptly;
 * use {@link withBudget} when the operation does not accept a signal.
 */
export function createBudgetSignal(options: BudgetOptions | undefined): BudgetSignal {
  const limitMs = normalizeBudgetMs(options?.limitMs)
  if (!options || limitMs === undefined) {
    return { signal: undefined, refresh: () => {}, dispose: () => {} }
  }

  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  const arm = (): void => {
    if (controller.signal.aborted) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => controller.abort(new TimeoutError({ ...options, limitMs })), limitMs)
  }

  arm()

  return {
    signal: controller.signal,
    refresh: arm,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
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
  const limitMs = normalizeBudgetMs(options?.limitMs)
  if (!options || limitMs === undefined) return fn(undefined)

  const budget = createBudgetSignal({ ...options, limitMs })
  try {
    return await Promise.race([
      fn(budget.signal),
      new Promise<never>((_, reject) => {
        budget.signal?.addEventListener(
          'abort',
          () => {
            reject(budget.signal?.reason ?? new TimeoutError({ ...options, limitMs }))
          },
          { once: true },
        )
      }),
    ])
  } finally {
    budget.dispose()
  }
}
