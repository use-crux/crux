import type {
  CompletedOperationProviderPayload,
  OperationTimeout,
} from "../../completed-operation/contracts";
import type { WithOperationResultMeta } from "../../observability";
import type {
  CompletedOperationModelGuard,
  RoutingCallOptions,
} from "../../routing/types";
import type { CompletedOperationDefinition } from "./definition";
import type { CompletedMediaOperationName } from "./observability-primitive";
import type { CompletedOperationSafetyOptions } from "./safety/options";

/** Options owned by the shared bounded-media lifecycle. */
export type RunCompletedMediaOperationOptions<
  TModel,
  TInput,
  TNormalized,
  TNative,
  TResult extends CompletedOperationProviderPayload,
  TReport,
  TSelectedModel = TModel,
  TOperation extends string = string,
> = Readonly<{
  /** Provider-authored mechanics whose validation result is always ID-free. */
  readonly definition: CompletedOperationDefinition<
    TModel,
    TInput,
    TNormalized,
    TNative,
    TResult,
    TReport
  >;
  readonly provider: string;
  /** Known media names make the returned result observable. */
  readonly operation: TOperation;
  readonly model: TSelectedModel;
  readonly input: TInput;
  readonly abortSignal?: AbortSignal;
  readonly timeout?: OperationTimeout;
  /** Context consumed by router/split callbacks. */
  readonly routing?: object;
  /** Optional top-level route override. */
  readonly route?: string;
  /** Internal descriptor sink. Reports must contain safe facts only. */
  readonly onReport?: (report: unknown) => void;
}> &
  CompletedOperationSafetyOptions &
  CompletedOperationModelGuard<TModel, TSelectedModel> &
  RoutingCallOptions<TSelectedModel>;

/**
 * Result exposed by the generic completed-operation runner.
 *
 * Known media names receive the exact owning span pair. Custom or widened
 * operation names remain provider payloads because Core has no primitive
 * ownership contract for them.
 */
export type CompletedMediaOperationResult<
  TOperation extends string,
  TResult extends CompletedOperationProviderPayload,
> = TOperation extends CompletedMediaOperationName
  ? WithOperationResultMeta<TResult>
  : TResult;
