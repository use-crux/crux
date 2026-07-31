/**
 * Public input-budget configuration and definition/invocation merging.
 *
 * @module
 */

/**
 * Per-provider-call input pressure settings.
 *
 * `optimizeAt` is a soft watermark and `max` is the strict input limit. Neither
 * setting is cumulative across an Agent run.
 *
 * @example
 * ```ts
 * const inputBudget: InputBudget = {
 *   optimizeAt: 80_000,
 *   max: 180_000,
 * };
 * ```
 */
export interface InputBudget {
  /** Soft watermark that activates authorized representation reductions. */
  readonly optimizeAt?: number;
  /** Strict maximum input tokens allowed for one provider call. */
  readonly max?: number;
}

/**
 * Merge definition defaults with invocation overrides per field.
 *
 * An omitted invocation field preserves the definition value. The returned
 * value is frozen and never mutates either input.
 *
 * @param definition - Definition-level defaults.
 * @param invocation - Invocation-level overrides.
 * @returns The validated merged budget, or `undefined` when both are absent.
 */
export function mergeInputBudget(
  definition?: InputBudget,
  invocation?: InputBudget,
): InputBudget | undefined {
  if (!definition && !invocation) return undefined;
  const merged = {
    ...(definition?.optimizeAt !== undefined
      ? { optimizeAt: definition.optimizeAt }
      : {}),
    ...(definition?.max !== undefined ? { max: definition.max } : {}),
    ...(invocation?.optimizeAt !== undefined
      ? { optimizeAt: invocation.optimizeAt }
      : {}),
    ...(invocation?.max !== undefined ? { max: invocation.max } : {}),
  };
  validateInputBudget(merged);
  return Object.freeze(merged);
}

/** Validate one input budget before request planning begins. @internal */
export function validateInputBudget(inputBudget: InputBudget): void {
  validateLimit("inputBudget.optimizeAt", inputBudget.optimizeAt);
  validateLimit("inputBudget.max", inputBudget.max);
  if (
    inputBudget.optimizeAt !== undefined &&
    inputBudget.max !== undefined &&
    inputBudget.optimizeAt > inputBudget.max
  ) {
    throw new TypeError(
      "inputBudget.optimizeAt must be less than or equal to inputBudget.max.",
    );
  }
}

function validateLimit(name: string, value: number | undefined): void {
  if (
    value === undefined ||
    (Number.isSafeInteger(value) && value > 0)
  ) {
    return;
  }
  throw new TypeError(`${name} must be a positive safe integer.`);
}
