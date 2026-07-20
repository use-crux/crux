import type {
  CompletedOperationProviderPayload,
  OperationTimeout,
} from "../../completed-operation/contracts";
import type { CompletedOperationDefinition } from "./definition";
import {
  runCompletedMediaOperation,
} from "./runner";
import type {
  CompletedMediaOperationResult,
  RunCompletedMediaOperationOptions,
} from "./runner-types";
import type {
  CompletedOperationModelGuard,
  RoutingCallOptions,
} from "../../routing/types";
import type { Guardrail } from "../../safety/guardrail/types";
import type { Constraint } from "../../safety/constraint/types";
import type { SafetyTuneOptions } from "../../safety/tune";

/** Minimum call shape shared by all bounded provider media operations. */
export interface CompletedOperationCall<TModel> {
  readonly model: TModel;
  readonly abortSignal?: AbortSignal;
  readonly timeout?: OperationTimeout;
  /** Canonical guardrails attached to this completed operation. */
  readonly guardrails?: readonly Guardrail[];
  /** Terminal constraints where the concrete operation contract supports them. */
  readonly constraints?: readonly Constraint[];
  /** Per-call posture tuning for attached guardrails. */
  readonly safety?: SafetyTuneOptions;
}

/** Public call signature compiled from one provider-authored definition. */
export type BoundCompletedOperation<
  TModel,
  TInput extends CompletedOperationCall<TModel>,
  TResult extends object,
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
  TResult extends CompletedOperationProviderPayload,
  TReport,
  TOperation extends string = string,
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
  readonly operation: TOperation;
  /** Internal safe-descriptor sink; raw media must never be reported. */
  readonly onReport?: (report: unknown) => void;
}

/**
 * Bind a provider-authored completed operation to the shared Crux lifecycle.
 *
 * Definitions validate ID-free payloads. A known media `operation` returns a
 * public result carrying the exact shared-runner span pair; a custom name stays
 * payload-only because it has no declared observability owner.
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
  TResult extends CompletedOperationProviderPayload,
  TReport = unknown,
  const TOperation extends string = string,
>(
  options: BindCompletedOperationOptions<
    TModel,
    TInput,
    TNormalized,
    TNative,
    TResult,
    TReport,
    TOperation
  >,
): BoundCompletedOperation<
  TModel,
  TInput,
  CompletedMediaOperationResult<TOperation, TResult>
> {
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
      guardrails: input.guardrails,
      constraints: input.constraints,
      safety: input.safety,
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
        TSelectedModel,
        TOperation
      >,
    );
  };
  return run as BoundCompletedOperation<
    TModel,
    TInput,
    CompletedMediaOperationResult<TOperation, TResult>
  >;
}
