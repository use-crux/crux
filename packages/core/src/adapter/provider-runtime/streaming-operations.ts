import type { GenerateImagePayload } from "../../generation/image-contracts";
import type { ImageStreamEvent } from "../../generation/image-stream-contracts";
import type { WithOperationResultMeta } from "../../observability";
import type { GenerateSpeechPayload } from "../../speech/contracts";
import type { SpeechStreamEvent } from "../../speech/stream-contracts";
import type {
  BoundStreamingOperation,
  StreamingOperationCall,
} from "../streaming-operation";
import {
  bindStreamingOperation,
  type StreamingOperationDefinition,
} from "../streaming-operation";

type ImageStreamCandidate = Exclude<
  ImageStreamEvent,
  { readonly type: "start" | "image" | "finish" }
>;

type SpeechStreamCandidate = Exclude<
  SpeechStreamEvent,
  { readonly type: "start" | "audio" | "finish" }
>;

/** Existential definition shape used only to constrain provider factories. */
type StreamingDefinition = Readonly<{
  normalize: (...args: never[]) => unknown;
  support: (...args: never[]) => "supported" | "unsupported" | "unknown";
  open: (...args: never[]) => unknown;
  validate: (...args: never[]) => GenerateImagePayload | GenerateSpeechPayload;
  report: (...args: never[]) => unknown;
  conformance: readonly unknown[];
}>;

/** Creates one immutable streaming definition after a provider client is bound. */
export type ProviderStreamingOperationFactory<
  TClient,
  TDefinition extends StreamingDefinition = StreamingDefinition,
> = (client: TClient) => TDefinition;

/** Optional genuine bounded streams declared by a provider runtime. */
export interface ProviderStreamingOperationFactories<TClient> {
  /** Native image stream. Omit when the provider cannot emit progressive images. */
  readonly image?: ProviderStreamingOperationFactory<TClient>;
  /** Native speech stream. Omit when the provider cannot emit progressive audio. */
  readonly speech?: ProviderStreamingOperationFactory<TClient>;
}

type FactoryAt<TFactories, TKey extends PropertyKey> =
  TFactories extends Readonly<Record<TKey, infer TFactory>>
    ? TFactory
    : undefined;

type BoundFromFactory<
  TFactory,
  TOperation extends "streamImage" | "streamSpeech",
> = TFactory extends (
  client: never,
) => StreamingOperationDefinition<
  infer TModel,
  infer TInput,
  infer _TNormalized,
  infer _TNativeEvent,
  infer _TNativeResult,
  infer TEvent,
  infer TResult,
  infer _TReport
>
  ? [TInput] extends [StreamingOperationCall<TModel>]
    ? TOperation extends "streamImage"
      ? TEvent extends ImageStreamCandidate
        ? TResult extends GenerateImagePayload
          ? BoundStreamingOperation<
              TModel,
              TInput,
              ImageStreamEvent,
              WithOperationResultMeta<TResult>
            >
          : never
        : never
      : TEvent extends SpeechStreamCandidate
        ? TResult extends GenerateSpeechPayload
          ? BoundStreamingOperation<
              TModel,
              TInput,
              SpeechStreamEvent,
              WithOperationResultMeta<TResult>
            >
          : never
        : never
    : never
  : never;

/**
 * Runtime functions compiled only for genuine streaming factories that exist.
 *
 * The mapped type remains internal to capability composition: consumers see
 * ordinary `streamImage` and `streamSpeech` members, never conditional options.
 */
export type DefinedStreamingOperations<TFactories> = (FactoryAt<
  TFactories,
  "image"
> extends ProviderStreamingOperationFactory<never>
  ? Readonly<{
      streamImage: BoundFromFactory<
        FactoryAt<TFactories, "image">,
        "streamImage"
      >;
    }>
  : Record<never, never>) &
  (FactoryAt<
    TFactories,
    "speech"
  > extends ProviderStreamingOperationFactory<never>
    ? Readonly<{
        streamSpeech: BoundFromFactory<
          FactoryAt<TFactories, "speech">,
          "streamSpeech"
        >;
      }>
    : Record<never, never>);

/** @internal Bind declared factories without manufacturing unsupported stubs. */
export function bindProviderStreamingOperations(
  provider: string,
  client: unknown,
  factories: ProviderStreamingOperationFactories<unknown> | undefined,
): object {
  return Object.freeze({
    ...(factories?.image === undefined
      ? {}
      : {
          streamImage: bindStreamingOperation({
            definition: factories.image(
              client,
            ) as unknown as StreamingOperationDefinition<
              unknown,
              StreamingOperationCall<unknown>,
              unknown,
              unknown,
              unknown,
              ImageStreamCandidate,
              GenerateImagePayload,
              unknown
            >,
            provider,
            operation: "streamImage",
          }),
        }),
    ...(factories?.speech === undefined
      ? {}
      : {
          streamSpeech: bindStreamingOperation({
            definition: factories.speech(
              client,
            ) as unknown as StreamingOperationDefinition<
              unknown,
              StreamingOperationCall<unknown>,
              unknown,
              unknown,
              unknown,
              SpeechStreamCandidate,
              GenerateSpeechPayload,
              unknown
            >,
            provider,
            operation: "streamSpeech",
          }),
        }),
  });
}
