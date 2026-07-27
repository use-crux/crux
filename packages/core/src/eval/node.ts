/** Public Node.js discovery and execution API for authored Evals. */

import type { AnyEval, Eval } from "./evaluate";
import { getEvalDefinitionForInternalUse } from "./internal/definition";
import type { EvalPlan, EvalRun } from "./internal/types";

export type {
  EvalPlan,
  EvalRun,
  EvalVariantAggregate,
} from "./internal/types";

export interface RunEvalOptions {
  readonly case?: string | readonly string[];
  readonly variant?: string;
  readonly fresh?: boolean;
  readonly offline?: boolean;
  readonly plan?: boolean;
  readonly maxCostUsd?: number;
}

export interface RunEvalPlanOptions extends RunEvalOptions {
  readonly plan: true;
}

type EvalScoreNames<T> = T extends Eval<never, unknown, infer S, string, string | undefined>
  ? S
  : string;
type EvalVariantNames<T> = T extends Eval<never, unknown, string, infer V, string | undefined>
  ? V
  : string;

/** Options narrowed to the authored Variant literals of one Eval object. */
export type RunEvalObjectOptions<T extends AnyEval> = Omit<
  RunEvalOptions,
  "variant"
> & { readonly variant?: "current" | EvalVariantNames<T> };

type RunOf<T extends AnyEval> = EvalRun<
  EvalScoreNames<T>,
  EvalVariantNames<T>
>;

export function runEval(
  evalOrId: string,
  options: RunEvalPlanOptions,
): Promise<EvalPlan>;
export function runEval<T extends AnyEval>(
  evalOrId: T,
  options: RunEvalObjectOptions<T> & { readonly plan: true },
): Promise<EvalPlan>;
export function runEval(
  evalOrId: string,
  options?: RunEvalOptions & { readonly plan?: false | undefined },
): Promise<EvalRun>;
export function runEval<T extends AnyEval>(
  evalOrId: T,
  options?: RunEvalObjectOptions<T> & {
    readonly plan?: false | undefined;
  },
): Promise<RunOf<T>>;
export function runEval(
  evalOrId: string,
  options: RunEvalOptions,
): Promise<EvalPlan | EvalRun>;
export function runEval<T extends AnyEval>(
  evalOrId: T,
  options: RunEvalObjectOptions<T>,
): Promise<EvalPlan | RunOf<T>>;
/**
 * Discover and run one authored Eval through the Node coordinator.
 *
 * @remarks
 * Live execution emits Run V4. A timed-out task produces a complete,
 * non-passing `timed_out` cell; scorers and assertions remain outside the task
 * deadline. Cancellation is cooperative, so ignored late work may continue
 * but cannot change the sealed cell or publish reusable evidence.
 *
 * @param evalOrId - An exact discovered Eval object or non-empty Eval selector.
 * @param options - Selection, freshness, offline, planning, and cost controls.
 * @returns A plan when `plan: true`; otherwise the persisted Eval Run.
 * @throws {TypeError} When the selector, Eval object, or cost limit is invalid.
 *
 * @example
 * ```ts
 * import { runEval } from '@use-crux/core/eval/node'
 *
 * const run = await runEval('support')
 * const timedOut = run.cells.filter((cell) => cell.status === 'timed_out')
 * ```
 */
export async function runEval(
  evalOrId: AnyEval | string,
  options: RunEvalOptions = {},
): Promise<EvalPlan | EvalRun> {
  if (typeof evalOrId === "string") {
    if (evalOrId.trim() === "") {
      throw new TypeError("runEval(): string selector must be non-empty.");
    }
  } else {
    if (
      evalOrId === null ||
      typeof evalOrId !== "object" ||
      !("_tag" in evalOrId) ||
      evalOrId._tag !== "CruxEval"
    ) {
      throw new TypeError(
        "runEval(): object form requires an Eval created by evaluate().",
      );
    }
    if (getEvalDefinitionForInternalUse(evalOrId).explicitId === undefined) {
      throw new TypeError(
        "runEval(): object form requires an explicit evaluate({ id }). Use the string id/path form for a path-derived Eval.",
      );
    }
  }
  if (
    options.maxCostUsd !== undefined &&
    (!Number.isFinite(options.maxCostUsd) || options.maxCostUsd < 0)
  ) {
    throw new TypeError(
      "runEval(): maxCostUsd must be a non-negative finite number.",
    );
  }
  const { runDiscoveredEval } = await import("./node/runner");
  return runDiscoveredEval(evalOrId, options, process.cwd());
}
