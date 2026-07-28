import type { GenerateImagePayload } from "../../generation/image-contracts";
import type { ImageStreamEvent } from "../../generation/image-stream-contracts";
import type { WithOperationResultMeta } from "../../observability";
import type {
  CompletedOperationModelGuard,
  RoutingCallOptions,
} from "../../routing/types";
import type { Guardrail } from "../../safety/guardrail/types";
import type { SafetyTuneOptions } from "../../safety/tune";
import type { OperationTimeout } from "../../completed-operation/contracts";
import type { GenerateSpeechPayload } from "../../speech/contracts";
import type { SpeechStreamEvent } from "../../speech/stream-contracts";
import type { StreamingOperationDefinition } from "./definition";
import { runStreamingOperation } from "./runner";
import type { StreamingOperationResult } from "./runner-types";

/** Closed bounded-stream operations understood by the shared Core runner. */
type StreamingOperationName = "streamImage" | "streamSpeech";

/** Minimum call shape shared by bounded provider streams. */
export interface StreamingOperationCall<TModel> {
  readonly model: TModel;
  readonly abortSignal?: AbortSignal;
  readonly guardrails?: readonly Guardrail[];
  readonly safety?: SafetyTuneOptions;
  readonly timeout?: OperationTimeout;
}

type EventForOperation<TOperation extends StreamingOperationName> =
  TOperation extends "streamImage" ? ImageStreamEvent : SpeechStreamEvent;

type CandidateEventForOperation<TOperation extends StreamingOperationName> =
  TOperation extends "streamImage"
    ? Extract<
        ImageStreamEvent,
        { readonly type: "image-preview" | "image-delta" }
      >
    : Extract<SpeechStreamEvent, { readonly type: "audio-delta" }>;

type PayloadForOperation<TOperation extends StreamingOperationName> =
  TOperation extends "streamImage"
    ? GenerateImagePayload
    : GenerateSpeechPayload;

/** Public call signature compiled from one provider streaming definition. */
export type BoundStreamingOperation<
  TModel,
  TInput extends StreamingOperationCall<TModel>,
  TEvent,
  TResult extends object,
> = ((input: TInput) => Promise<StreamingOperationResult<TEvent, TResult>>) &
  (<TSelectedModel>(
    input: Omit<TInput, "model" | "routing" | "route"> &
      Readonly<{ model: TSelectedModel }> &
      CompletedOperationModelGuard<TInput["model"], TSelectedModel> &
      RoutingCallOptions<TSelectedModel>,
  ) => Promise<StreamingOperationResult<TEvent, TResult>>);

/** Adapter-author options for binding an immutable streaming definition. */
export interface BindStreamingOperationOptions<
  TOperation extends StreamingOperationName,
  TModel,
  TInput extends StreamingOperationCall<TModel>,
  TNormalized,
  TNativeEvent,
  TNativeResult,
  TEvent extends CandidateEventForOperation<TOperation>,
  TResult extends PayloadForOperation<TOperation>,
  TReport,
> {
  readonly definition: StreamingOperationDefinition<
    TModel,
    TInput,
    TNormalized,
    TNativeEvent,
    TNativeResult,
    TEvent,
    TResult,
    TReport
  >;
  readonly provider: string;
  readonly operation: TOperation;
  /** Internal safe-descriptor sink; media and native events are never passed. */
  readonly onReport?: (report: unknown) => void;
}

/**
 * Bind a provider-authored bounded stream to the shared Core contract.
 *
 * The provider definition remains immutable and reusable; each call opens an
 * independent native source and mapper. The bound function performs no media
 * persistence and exposes canonical events only. Selected routing models keep
 * the same classifier-context guard as completed media operations.
 *
 * @example
 * ```ts
 * const streamImage = bindStreamingOperation({
 *   definition: imageStreamDefinition,
 *   provider: 'example',
 *   operation: 'streamImage',
 * })
 * ```
 */
export function bindStreamingOperation<
  const TOperation extends StreamingOperationName,
  TModel,
  TInput extends StreamingOperationCall<TModel>,
  TNormalized,
  TNativeEvent,
  TNativeResult,
  TEvent extends CandidateEventForOperation<TOperation>,
  TResult extends PayloadForOperation<TOperation>,
  TReport = unknown,
>(
  options: BindStreamingOperationOptions<
    TOperation,
    TModel,
    TInput,
    TNormalized,
    TNativeEvent,
    TNativeResult,
    TEvent,
    TResult,
    TReport
  >,
): BoundStreamingOperation<
  TModel,
  TInput,
  EventForOperation<TOperation>,
  WithOperationResultMeta<TResult>
> {
  const run = <TSelectedModel>(
    input: Omit<TInput, "model" | "routing" | "route"> &
      Readonly<{ model: TSelectedModel }> &
      CompletedOperationModelGuard<TInput["model"], TSelectedModel> &
      RoutingCallOptions<TSelectedModel>,
  ) =>
    runStreamingOperation({
      definition: options.definition,
      provider: options.provider,
      operation: options.operation,
      model: input.model as unknown as TModel,
      input: input as unknown as TInput,
      abortSignal: input.abortSignal,
      guardrails: input.guardrails,
      safety: input.safety,
      timeout: input.timeout,
      routing: input.routing,
      route: input.route,
      onReport: options.onReport,
    });

  return run as BoundStreamingOperation<
    TModel,
    TInput,
    EventForOperation<TOperation>,
    WithOperationResultMeta<TResult>
  >;
}
