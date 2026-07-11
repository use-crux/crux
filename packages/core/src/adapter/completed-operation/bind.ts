import type {
  CompletedOperationResult,
  OperationTimeout,
} from "../../completed-operation/contracts";
import type { CompletedOperationDefinition } from "./definition";
import { runCompletedMediaOperation } from "./runner";

/** Minimum call shape shared by all bounded provider media operations. */
export interface CompletedOperationCall<TModel> {
  readonly model: TModel;
  readonly abortSignal?: AbortSignal;
  readonly timeout?: OperationTimeout;
}

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
): (input: TInput) => Promise<TResult> {
  return (input) =>
    runCompletedMediaOperation({
      definition: options.definition,
      provider: options.provider,
      operation: options.operation,
      model: input.model,
      input,
      abortSignal: input.abortSignal,
      timeout: input.timeout,
      ...(options.onReport === undefined ? {} : { onReport: options.onReport }),
    });
}
