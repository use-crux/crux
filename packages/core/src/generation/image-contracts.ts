import type { z } from 'zod'
import type { Asset, DataAsset } from '../asset/types'
import type { ContextEntry } from '../prompt/context-types'
import type { Prompt } from '../prompt/prompt-types'
import type { MergedInput } from '../prompt/type-utils'
import type { AnyToolSet } from '../types'

/** A direct text prompt, composed Crux prompt, or native image-edit prompt. */
export type ImagePrompt = string | AnyImageCruxPrompt | ImagePromptContent

/** Text plus optional reference images and one edit mask. */
export interface ImagePromptContent {
  readonly text: string
  readonly images?: readonly Asset[]
  readonly mask?: Asset
}

type AnyImageCruxPrompt = Prompt<z.ZodType, z.ZodType | undefined, readonly ContextEntry[], AnyToolSet | undefined>

type PromptInput<TPrompt> = TPrompt extends Prompt<infer TOwnInput, z.ZodType | undefined, infer TContexts, infer _TTools>
  ? MergedInput<TOwnInput, TContexts>
  : never

type PromptInputOption<TPrompt> = TPrompt extends AnyImageCruxPrompt
  ? [keyof PromptInput<TPrompt>] extends [never]
    ? { readonly input?: undefined }
    : { readonly input: PromptInput<TPrompt> }
  : { readonly input?: never }

/** Portable controls shared by native image-generation adapters. */
export interface GenerateImageCommonOptions {
  /** Number of images requested. Must be a positive integer. */
  readonly n?: number
  /** Requested pixel dimensions in `WIDTHxHEIGHT` form. */
  readonly size?: `${number}x${number}`
  /** Requested width-to-height ratio in `WIDTH:HEIGHT` form. */
  readonly aspectRatio?: `${number}:${number}`
  /** Deterministic provider seed, when supported. */
  readonly seed?: number
  /** Budget used while resolving a composed Crux prompt. */
  readonly tokenBudget?: number
}

/** Options accepted by a flat provider image-generation function. */
export type GenerateImageOptions<
  TModel = string,
  TExtra extends Record<string, unknown> = Record<string, never>,
  TPrompt extends ImagePrompt = ImagePrompt,
> = GenerateImageCommonOptions & PromptInputOption<TPrompt> & {
  readonly model: TModel
  readonly prompt: TPrompt
  /** Provider-native controls that have no portable Crux equivalent. */
  readonly extra?: TExtra
}

/** Provider-neutral image usage counters. Unknown counters remain omitted. */
export interface GeneratedImageUsage {
  readonly images?: number
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
}

/** Result of one native image operation. The first image is also available as `image`. */
export interface GeneratedImage<TRaw = unknown, TProviderMetadata = unknown, TResponse = unknown> {
  readonly image: DataAsset
  readonly images: readonly [DataAsset, ...DataAsset[]]
  readonly usage?: GeneratedImageUsage
  readonly warnings?: readonly string[]
  readonly providerMetadata?: TProviderMetadata
  readonly response?: TResponse
  /** Unmodified native operation result. */
  readonly raw: TRaw
}

/** Flat image-generation function. Prompt input is inferred from a typed Crux prompt. */
export type GenerateImage<
  TModel = string,
  TExtra extends Record<string, unknown> = Record<string, never>,
  TRaw = unknown,
  TProviderMetadata = unknown,
  TResponse = unknown,
> = <TPrompt extends ImagePrompt>(
  options: GenerateImageOptions<TModel, TExtra, TPrompt>,
) => Promise<GeneratedImage<TRaw, TProviderMetadata, TResponse>>

/** Native image bytes before provider-neutral result validation. */
export interface NativeGeneratedImage {
  readonly data: Uint8Array | string
  readonly mediaType: string
  readonly filename?: string
}
