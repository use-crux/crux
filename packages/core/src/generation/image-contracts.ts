import type { z } from "zod";
import type { Asset } from "../asset/types";
import type {
  CompletedOperationResult,
  OperationTimeout,
} from "../completed-operation/contracts";
import type { ContextEntry } from "../prompt/context-types";
import type { Prompt } from "../prompt/prompt-types";
import type { MergedInput } from "../prompt/type-utils";
import type { AnyToolSet } from "../types";
import type { AnyRoutable, RoutingCallOptions } from "../routing/types";

/** A direct text prompt, composed Crux prompt, or native image-edit prompt. */
export type ImagePrompt = string | AnyImageCruxPrompt | ImagePromptContent;

/** Text plus optional reference images and one edit mask. */
export type ImagePromptContent =
  | Readonly<{
      text: string;
      images?: readonly [Asset, ...Asset[]];
      mask?: never;
    }>
  | Readonly<{
      text: string;
      images: readonly [Asset, ...Asset[]];
      mask: Asset;
    }>;

type AnyImageCruxPrompt = Prompt<
  z.ZodType,
  z.ZodType | undefined,
  readonly ContextEntry[],
  AnyToolSet | undefined
>;

type PromptInput<TPrompt> =
  TPrompt extends Prompt<
    infer TOwnInput,
    z.ZodType | undefined,
    infer TContexts,
    infer _TTools
  >
    ? MergedInput<TOwnInput, TContexts>
    : never;

type PromptInputOption<TPrompt> = TPrompt extends AnyImageCruxPrompt
  ? [keyof PromptInput<TPrompt>] extends [never]
    ? { readonly input?: undefined }
    : { readonly input: PromptInput<TPrompt> }
  : { readonly input?: never };

/** Portable controls shared by native image-generation adapters. */
export type GenerateImageCommonOptions = Readonly<{
  /** Number of images requested. Must be a positive integer. */
  n?: number;
  /** Deterministic provider seed, when supported. */
  seed?: number;
  /** Cooperative cancellation for the whole operation. */
  abortSignal?: AbortSignal;
  /** Whole-operation and per-attempt timeout budgets. */
  timeout?: OperationTimeout;
}>;

type ImageDimensions =
  | Readonly<{ size?: `${number}x${number}`; aspectRatio?: never }>
  | Readonly<{ size?: never; aspectRatio?: `${number}:${number}` }>;

/** Options accepted by a flat provider image-generation function. */
export type GenerateImageOptions<
  TModel = string,
  TExtra = never,
  TPrompt extends ImagePrompt = ImagePrompt,
> = GenerateImageCommonOptions &
  ImageDimensions &
  PromptInputOption<TPrompt> & {
    readonly model: TModel;
    readonly prompt: TPrompt;
    /** Provider-native controls that have no portable Crux equivalent. */
    readonly extra?: TExtra;
  };

/** Result of one image operation. `image` is the first provider-ordered asset. */
export type GenerateImageResult<
  TRaw = unknown,
  TProviderMetadata = unknown,
  TWarning = unknown,
> = CompletedOperationResult<TRaw, TProviderMetadata, TWarning> &
  Readonly<{
    images: readonly [Asset, ...Asset[]];
    image: Asset;
  }>;

/**
 * Flat image-generation function. Prompt input is inferred from a typed Crux prompt.
 *
 * @example
 * ```ts
 * const result = await adapter.generateImage({ model: 'image-1', prompt: 'A quiet canal' })
 * await assetStore.put(result.image) // optional, explicit persistence
 * ```
 */
export type GenerateImage<
  TModel = string,
  TExtra = never,
  TRaw = unknown,
  TProviderMetadata = unknown,
  TWarning = unknown,
> = <
  TPrompt extends ImagePrompt,
  TSelectedModel extends TModel | AnyRoutable = TModel,
>(
  options: GenerateImageOptions<TSelectedModel, TExtra, TPrompt> &
    RoutingCallOptions<TSelectedModel>,
) => Promise<GenerateImageResult<TRaw, TProviderMetadata, TWarning>>;

/** Native generated image before provider-neutral result validation. */
export type NativeGeneratedImage =
  | Asset
  | Readonly<{
      data: Uint8Array | string;
      mediaType: string;
      filename?: string;
    }>;
