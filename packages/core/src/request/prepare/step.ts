/**
 * Deadline-bound orchestration for per-provider-call preparation.
 *
 * @module
 */

import type { Message } from "../../generation/messages";
import type { RequestReceipt } from "../receipt/receipt";
import type { ExecutionAmendment } from "./amendment";
import {
  createStepContext,
  stepToolHistory,
  type StepContext,
  type StepReason,
  type StepPreparationStats,
} from "./step-context";
import {
  emptyPreparationResources,
  ResourceReadError,
  type PreparationResources,
} from "./resources";

const PREPARATION_TIMEOUT_MS = 30_000;

/**
 * Callback evaluated once before one semantic language provider call.
 *
 * The callback receives immutable, provider-neutral facts and may return only
 * a constrained boundary-local delta. Exact transport retries reuse the
 * accepted decision without evaluating this callback again.
 *
 * @example
 * ```ts
 * const prepareStep: PrepareStep<Model> = ({ stats }) =>
 *   stats.run.usage.coverage.tokens === 'complete'
 *     ? { inputBudget: { max: 32_000 } }
 *     : undefined
 * ```
 */
export type PrepareStep<TModel = unknown> = (
  context: StepContext,
) =>
  | ExecutionAmendment<TModel>
  | undefined
  | Promise<ExecutionAmendment<TModel> | undefined>;

/** Stable reasons a preparation boundary failed before dispatch. */
export type PreparationErrorReason = "callback" | "timeout" | "aborted";

/** Typed, content-free preparation failure raised before provider dispatch. */
export class PreparationError extends Error {
  /** Stable content-free failure classification. */
  readonly reason: PreparationErrorReason;

  /**
   * Create a preparation failure.
   *
   * @param reason - Stable failure classification.
   */
  constructor(reason: PreparationErrorReason) {
    super(`Request preparation failed: ${reason}.`);
    this.name = "PreparationError";
    this.reason = reason;
  }
}

/** Mutable execution-local state behind immutable statistics snapshots. @internal */
export interface PrepareStepState {
  index: number;
  succeeded: number;
  transportRetries: number;
  usageReports: number;
  inputTokens: number;
  outputTokens: number;
}

/** Create preparation state for one managed run. @internal */
export function createPrepareStepState(): PrepareStepState {
  return {
    index: 0,
    succeeded: 0,
    transportRetries: 0,
    usageReports: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

/** Add one completed provider-call outcome to later statistics snapshots. @internal */
export function recordPrepareStepOutcome(
  state: PrepareStepState,
  outcome: {
    readonly usage?: {
      readonly inputTokens?: number;
      readonly outputTokens?: number;
    };
    readonly transportRetries?: number;
  },
): void {
  state.succeeded += 1;
  state.transportRetries += outcome.transportRetries ?? 0;
  if (!outcome.usage) return;
  state.usageReports += 1;
  state.inputTokens += outcome.usage.inputTokens ?? 0;
  state.outputTokens += outcome.usage.outputTokens ?? 0;
}

/** Evaluate one callback under its deadline and return its delta. @internal */
export async function runPrepareStep<TModel>(input: {
  readonly callback?: PrepareStep<TModel>;
  readonly state: PrepareStepState;
  readonly requestInput: Readonly<Record<string, unknown>>;
  readonly reason: StepReason;
  readonly previousReceipt?: RequestReceipt;
  readonly messages: readonly Message[];
  readonly resources?: PreparationResources;
  readonly signal?: AbortSignal;
}): Promise<ExecutionAmendment<TModel> | undefined> {
  if (!input.callback) return undefined;
  if (input.signal?.aborted) throw new PreparationError("aborted");
  const index = input.state.index++;
  const controller = new AbortController();
  const abort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), PREPARATION_TIMEOUT_MS);
  const stats = createStats(input.state, index, input.reason);
  const context = createStepContext({
    operation: "language",
    input: input.requestInput,
    index,
    reason: input.reason,
    previousReceipt: input.previousReceipt,
    messages: input.messages,
    toolHistory: stepToolHistory(input.messages),
    stats,
    resources: input.resources ?? emptyPreparationResources(),
    signal: controller.signal,
  });
  try {
    return await Promise.race([
      Promise.resolve()
        .then(() => {
          const result = input.callback!(context);
          return isPromiseLike(result)
            ? Promise.resolve(result).then(snapshotAmendment)
            : snapshotAmendment(result);
        })
        .catch((error: unknown) => {
          if (
            error instanceof PreparationError ||
            error instanceof ResourceReadError
          ) {
            throw error;
          }
          throw new PreparationError("callback");
        }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          "abort",
          () =>
            reject(
              new PreparationError(input.signal?.aborted ? "aborted" : "timeout"),
            ),
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", abort);
  }
}

function isPromiseLike<T>(
  value: T | Promise<T>,
): value is Promise<T> {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function snapshotAmendment<TModel>(
  amendment: ExecutionAmendment<TModel> | undefined,
): ExecutionAmendment<TModel> | undefined {
  if (!amendment || typeof amendment !== "object") return amendment;
  return Object.freeze({
    ...(amendment.use
      ? {
          use: Object.freeze({
            ...(amendment.use.add
              ? { add: Object.freeze([...amendment.use.add]) }
              : {}),
            ...(amendment.use.remove
              ? { remove: Object.freeze([...amendment.use.remove]) }
              : {}),
          }),
        }
      : {}),
    ...(amendment.tools
      ? { tools: Object.freeze({ ...amendment.tools }) }
      : {}),
    ...(amendment.activeTools
      ? { activeTools: Object.freeze([...amendment.activeTools]) }
      : {}),
    ...(amendment.model !== undefined ? { model: amendment.model } : {}),
    ...(amendment.inputBudget
      ? { inputBudget: Object.freeze({ ...amendment.inputBudget }) }
      : {}),
  });
}

function createStats(
  state: PrepareStepState,
  index: number,
  reason: StepReason,
): StepPreparationStats {
  const tokenCoverage =
    state.succeeded === 0 || state.usageReports === 0
      ? "none" as const
      : state.usageReports === state.succeeded
        ? "complete" as const
        : "partial" as const;
  const inputTokens =
    tokenCoverage === "none" ? {} : { inputTokens: state.inputTokens };
  const outputTokens =
    tokenCoverage === "none" ? {} : { outputTokens: state.outputTokens };
  const scope = Object.freeze({
    usage: Object.freeze({
      ...inputTokens,
      ...outputTokens,
      ...(tokenCoverage === "none"
        ? {}
        : { totalTokens: state.inputTokens + state.outputTokens }),
      coverage: Object.freeze({ tokens: tokenCoverage, cost: "none" as const }),
    }),
    modelCalls: Object.freeze({
      started: index,
      succeeded: state.succeeded,
      failed: 0,
      cancelled: 0,
      transportRetries: state.transportRetries,
    }),
  });
  return {
    at: new Date(),
    cursor: index,
    attempt: Object.freeze({
      number: 1,
      reason: reason === "validation-retry" ? reason : "initial",
    }),
    run: scope,
    root: scope,
    stepIndex: index,
  };
}
