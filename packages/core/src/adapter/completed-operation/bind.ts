import type {
  CompletedOperationResult,
  OperationTimeout,
} from "../../completed-operation/contracts";
import type { CompletedOperationDefinition } from "./definition";
import {
  runCompletedMediaOperation,
  type RunCompletedMediaOperationOptions,
} from "./runner";
import type {
  CompletedOperationModelGuard,
  RoutingCallOptions,
} from "../../routing/types";

/** Minimum call shape shared by all bounded provider media operations. */
export interface CompletedOperationCall<TModel> {
  readonly model: TModel;
  readonly abortSignal?: AbortSignal;
  readonly timeout?: OperationTimeout;
}

/** Public call signature compiled from one provider-authored definition. */
export type BoundCompletedOperation<
  TModel,
  TInput extends CompletedOperationCall<TModel>,
  TResult extends CompletedOperationResult,
> = ((input: TInput) => Promise<TResult>) &
  (<TSelectedModel>(
    input: Omit<TInput, "model" | "routing" | "route"> &
      Readonly<{ model: TSelectedModel }> &
      CompletedOperationModelGuard<TInput["model"], TSelectedModel> &
      RoutingCallOptions<TSelectedModel>,
  ) => Promise<TResult>);

/** Adapter-author options for binding an immutable operation definition. */
export interface BindCompletedOperationOptions<
  TModel,
  TInput extends CompletedOperationCall<TModel>,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport,
> {
  readonly definition: CompletedOperationDefinition<
    TModel,
    TInput,
    TNormalized,
    TNative,
    TResult,
    TReport
  >;
  readonly provider: string;
  readonly operation: string;
  /** Internal safe-descriptor sink; raw media must never be reported. */
  readonly onReport?: (report: unknown) => void;
}

/**
 * Bind a provider-authored completed operation to the shared Crux lifecycle.
 *
 * The returned function performs no persistence and accepts no asset store.
 * Known unsupported requests fail before native I/O; native errors propagate
 * unchanged after invocation begins.
 *
 * @example
 * ```ts
 * const generateSpeech = bindCompletedOperation({
 *   definition: speechDefinition,
 *   provider: 'example',
 *   operation: 'generateSpeech',
 * })
 * ```
 */
export function bindCompletedOperation<
  TModel,
  TInput extends CompletedOperationCall<TModel>,
  TNormalized,
  TNative,
  TResult extends CompletedOperationResult,
  TReport = unknown,
>(
  options: BindCompletedOperationOptions<
    TModel,
    TInput,
    TNormalized,
    TNative,
    TResult,
    TReport
  >,
): BoundCompletedOperation<TModel, TInput, TResult> {
  const run = <TSelectedModel>(
    input: Omit<TInput, "model" | "routing" | "route"> &
      Readonly<{ model: TSelectedModel }> &
      CompletedOperationModelGuard<TInput["model"], TSelectedModel> &
      RoutingCallOptions<TSelectedModel>,
  ) => {
    const call = input as unknown as TInput & {
      readonly routing?: object;
      readonly route?: string;
    };
    const runOptions = {
      definition: options.definition,
      provider: options.provider,
      operation: options.operation,
      model: input.model,
      input: call,
      abortSignal: input.abortSignal,
      timeout: input.timeout,
      ...(call.routing !== undefined ? { routing: call.routing } : {}),
      ...(call.route !== undefined ? { route: call.route } : {}),
      ...(options.onReport === undefined ? {} : { onReport: options.onReport }),
    };
    return runCompletedMediaOperation(
      runOptions as RunCompletedMediaOperationOptions<
        TModel,
        TInput,
        TNormalized,
        TNative,
        TResult,
        TReport,
        TSelectedModel
      >,
    );
  };
  return run as BoundCompletedOperation<TModel, TInput, TResult>;
}
