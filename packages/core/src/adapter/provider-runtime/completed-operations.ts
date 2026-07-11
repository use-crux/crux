/**
 * First-class completed-operation declarations for provider runtimes.
 *
 * @module
 */

import type { CompletedOperationResult } from "../../completed-operation/contracts";
import {
  bindCompletedOperation,
  type BoundCompletedOperation,
  type CompletedOperationCall,
} from "../completed-operation";
import type { CompletedOperationDefinition } from "../completed-operation";

/** Existential definition shape used only to constrain provider factories. */
type CompletedDefinition = Readonly<{
  normalize: (...args: never[]) => unknown;
  support: (...args: never[]) => "supported" | "unsupported" | "unknown";
  invoke: (...args: never[]) => Promise<unknown>;
  validate: (...args: never[]) => CompletedOperationResult;
  report: (...args: never[]) => unknown;
  conformance: readonly unknown[];
}>;

/** Creates one immutable operation definition after a provider client is bound. */
export type ProviderCompletedOperationFactory<
  TClient,
  TDefinition extends CompletedDefinition = CompletedDefinition,
> = (client: TClient) => TDefinition;

/** Optional completed operations understood by the provider runtime compiler. */
export interface ProviderCompletedOperationFactories<
  TClient,
  TImage extends ProviderCompletedOperationFactory<TClient> | undefined =
    | ProviderCompletedOperationFactory<TClient>
    | undefined,
  TTranscription extends
    | ProviderCompletedOperationFactory<TClient>
    | undefined = ProviderCompletedOperationFactory<TClient> | undefined,
  TSpeech extends ProviderCompletedOperationFactory<TClient> | undefined =
    | ProviderCompletedOperationFactory<TClient>
    | undefined,
> {
  /** Native or honestly composed image operation. Omit when unsupported. */
  readonly image?: TImage;
  /** Native or honestly composed transcription operation. Omit when unsupported. */
  readonly transcription?: TTranscription;
  /** Native or honestly composed speech operation. Omit when unsupported. */
  readonly speech?: TSpeech;
}

type BoundFromFactory<TFactory> = TFactory extends (
  client: never,
) => CompletedOperationDefinition<
  infer TModel,
  infer TInput,
  infer _TNormalized,
  infer _TNative,
  infer TResult,
  infer _TReport
>
  ? [TInput] extends [CompletedOperationCall<TModel>]
    ? BoundCompletedOperation<TModel, TInput, TResult>
    : never
  : never;

/** Runtime functions compiled only for operation definitions that exist. */
export type DefinedCompletedOperations<TImage, TTranscription, TSpeech> =
  (TImage extends ProviderCompletedOperationFactory<never>
    ? Readonly<{ generateImage: BoundFromFactory<TImage> }>
    : Record<never, never>) &
    (TTranscription extends ProviderCompletedOperationFactory<never>
      ? Readonly<{ transcribe: BoundFromFactory<TTranscription> }>
      : Record<never, never>) &
    (TSpeech extends ProviderCompletedOperationFactory<never>
      ? Readonly<{ generateSpeech: BoundFromFactory<TSpeech> }>
      : Record<never, never>);

/** @internal Bind present definitions without manufacturing unsupported stubs. */
export function bindProviderCompletedOperations(
  provider: string,
  client: unknown,
  factories: ProviderCompletedOperationFactories<
    unknown,
    ProviderCompletedOperationFactory<unknown> | undefined,
    ProviderCompletedOperationFactory<unknown> | undefined,
    ProviderCompletedOperationFactory<unknown> | undefined
  >,
): object {
  return Object.freeze({
    ...(factories.image === undefined
      ? {}
      : {
          generateImage: bindCompletedOperation({
            definition: factories.image(
              client,
            ) as unknown as CompletedOperationDefinition<
              unknown,
              CompletedOperationCall<unknown>,
              unknown,
              unknown,
              CompletedOperationResult,
              unknown
            >,
            provider,
            operation: "generateImage",
          }),
        }),
    ...(factories.transcription === undefined
      ? {}
      : {
          transcribe: bindCompletedOperation({
            definition: factories.transcription(
              client,
            ) as unknown as CompletedOperationDefinition<
              unknown,
              CompletedOperationCall<unknown>,
              unknown,
              unknown,
              CompletedOperationResult,
              unknown
            >,
            provider,
            operation: "transcribe",
          }),
        }),
    ...(factories.speech === undefined
      ? {}
      : {
          generateSpeech: bindCompletedOperation({
            definition: factories.speech(
              client,
            ) as unknown as CompletedOperationDefinition<
              unknown,
              CompletedOperationCall<unknown>,
              unknown,
              unknown,
              CompletedOperationResult,
              unknown
            >,
            provider,
            operation: "generateSpeech",
          }),
        }),
  });
}
