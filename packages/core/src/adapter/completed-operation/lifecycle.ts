/** Internal completed-operation lifecycle projections. */

import {
  validateOperationExecution,
  type CompletedOperationResult,
} from "../../completed-operation/contracts";
import type {
  CompletedOperationContext,
  CompletedOperationDefinition,
} from "./definition";

/** Add failed routed attempts without replacing provider-owned call facts. */
export function finalizeCompletedResult<
  TResult extends CompletedOperationResult,
>(result: TResult, attemptedCalls: number): TResult {
  const failedAttemptCalls = Math.max(0, attemptedCalls - 1);
  const execution = validateOperationExecution({
    ...result.execution,
    calls: result.execution.calls + failedAttemptCalls,
  });
  return Object.freeze({
    ...result,
    warnings: Object.freeze([...result.warnings]),
    execution,
  });
}

/** Build immutable identity for one concrete provider attempt. */
export function completedLifecycleContext<TModel>(
  options: Readonly<{ provider: string; operation: string }>,
  model: TModel,
): CompletedOperationContext<TModel> {
  return Object.freeze({
    provider: options.provider,
    operation: options.operation,
    model,
  });
}

/** Resolve the normalized input and context that produced the final result. */
export async function selectedCompletedInput<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport,
>(
  prepared: ReadonlyMap<unknown, TNormalized>,
  input: TInput,
  definition: CompletedOperationDefinition<
    TModel,
    TInput,
    TNormalized,
    TNative,
    TResult,
    TReport
  >,
  options: Readonly<{ provider: string; operation: string; model: unknown }>,
  selectedModel: unknown,
): Promise<
  Readonly<{
    input: TNormalized;
    context: CompletedOperationContext<TModel>;
  }>
> {
  const first = prepared.entries().next().value as
    | readonly [unknown, TNormalized]
    | undefined;
  const model = (selectedModel ?? first?.[0] ?? options.model) as TModel;
  const context = completedLifecycleContext(options, model);
  const normalized = prepared.has(selectedModel)
    ? prepared.get(selectedModel)!
    : (first?.[1] ??
      (await definition.normalize(withSelectedModel(input, model), context)));
  return { input: normalized, context };
}

/** Replace an inert routing wrapper before provider normalization. */
export function withSelectedModel<TInput>(
  input: TInput,
  model: unknown,
): TInput {
  if (typeof input !== "object" || input === null || !("model" in input))
    return input;
  return Object.freeze({ ...input, model }) as TInput;
}
