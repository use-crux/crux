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
import type {
  CompletedOperationModelGuard,
  RoutingCallOptions,
} from "../routing/types";
import type { Guardrail } from "../safety/guardrail/types";
import type { SafetyTuneOptions } from "../safety/tune";

/** A direct text prompt, composed Crux prompt, or native image-edit prompt. */
export type ImagePrompt = string | AnyImageCruxPrompt | ImagePromptContent;

/**
 * Canonical image prompt text plus provider-ordered references and one edit mask.
 *
 * `images` indexes remain stable during Safety evaluation. An enforced strip
 * removes only the selected reference. A retained `mask` always requires at
 * least one retained reference, so stripping the final reference while keeping
 * the mask blocks before provider I/O. Report-mode strips preserve the prompt.
 */
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

/**
 * Portable controls shared by native image-generation adapters.
 *
 * Image operations support guardrails over canonical prompt images and
 * generated images. They intentionally do not expose output constraints or
 * constraint retry controls.
 */
export type GenerateImageCommonOptions = Readonly<{
  /** Number of images requested. Must be a positive integer. */
  n?: number;
  /** Deterministic provider seed, when supported. */
  seed?: number;
  /** Cooperative cancellation for the whole operation. */
  abortSignal?: AbortSignal;
  /** Whole-operation and per-attempt timeout budgets. */
  timeout?: OperationTimeout;
  /**
   * Guardrails applied to canonical prompt text, typed-prompt system text,
   * prompt references, masks, and generated images.
   *
   * Direct and resolved prompt text targets `boundary.input.user()`; a typed
   * prompt's resolved system text targets `boundary.input.model()`. Resolved
   * prompt guardrails merge with global and call policies before candidate
   * normalization. Media callbacks receive the original asset as
   * `subject.part.source` and a stable operation origin. Input strips are
   * written back before provider normalization; a retained edit mask with no
   * references blocks. Output strips remove generated images and block on the
   * final image. Report mode records intent without changing input or result.
   * Provider-native `raw` and metadata are not guarded.
   */
  guardrails?: readonly Guardrail[];
  /** Per-policy enablement and enforcement mode for attached guardrails. */
  safety?: SafetyTuneOptions;
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

/**
 * Result of one image operation.
 *
 * `images` is provider ordered and `image` is always its first retained asset.
 * Enforced output-media strips remove siblings immutably and reset `image` to
 * the first remaining asset; stripping the final image blocks. Provider-native
 * `raw`, metadata, and warnings retain their original identities and remain
 * outside canonical Safety guarantees.
 */
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
> = ((
  options: GenerateImageOptions<TModel, TExtra, ImagePrompt>,
) => Promise<GenerateImageResult<TRaw, TProviderMetadata, TWarning>>) &
  (<TPrompt extends ImagePrompt, TSelectedModel = TModel>(
    options: GenerateImageOptions<TSelectedModel, TExtra, TPrompt> &
      CompletedOperationModelGuard<TModel, TSelectedModel> &
      RoutingCallOptions<TSelectedModel>,
  ) => Promise<GenerateImageResult<TRaw, TProviderMetadata, TWarning>>);

/** Native generated image before provider-neutral result validation. */
export type NativeGeneratedImage =
  | Asset
  | Readonly<{
      data: Uint8Array | string;
      mediaType: string;
      filename?: string;
    }>;
