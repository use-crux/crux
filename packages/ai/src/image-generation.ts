import type { GenerateImageResult, ImageModel } from 'ai'
import {
  createGeneratedImageResult,
  createUnsupportedCapabilityError,
  lowerImagePrompt,
  validateGenerateImageOptions,
  type GenerateImage,
  type GeneratedImage,
  type UnsupportedCapabilityIssue,
} from '@use-crux/core'
import type { SdkGateway } from './gateway'

type NativeImageArgs = Parameters<SdkGateway['generateImage']>[0]

/** AI SDK-native controls forwarded unchanged to `generateImage()`. */
export interface AIImageExtra extends Record<string, unknown> {
  readonly maxImagesPerCall?: NativeImageArgs['maxImagesPerCall']
  readonly providerOptions?: NativeImageArgs['providerOptions']
  readonly maxRetries?: NativeImageArgs['maxRetries']
  readonly abortSignal?: NativeImageArgs['abortSignal']
  readonly headers?: NativeImageArgs['headers']
}

/**
 * Stateless AI SDK image operation.
 *
 * @example
 * ```ts
 * const result = await generateImage({ model: openai.image('gpt-image-1'), prompt: 'A quiet canal' })
 * await assetStore.put(result.image) // optional, explicit persistence
 * ```
 */
export type AIGenerateImage = GenerateImage<
  ImageModel,
  AIImageExtra,
  GenerateImageResult,
  GenerateImageResult['providerMetadata'],
  GenerateImageResult['responses'],
  GenerateImageResult['warnings'][number]
>

/** Bind one AI SDK image operation to an injectable gateway. */
export function createAiSdkGenerateImage(gateway: SdkGateway): AIGenerateImage {
  return async (options): Promise<GeneratedImage<
    GenerateImageResult,
    GenerateImageResult['providerMetadata'],
    GenerateImageResult['responses'],
    GenerateImageResult['warnings'][number]
  >> => {
    validateGenerateImageOptions(options)
    const prompt = await lowerImagePrompt(options, { adapter: 'ai-sdk', model: imageModelId(options.model) })
    const unsupported = [...prompt.images, ...(prompt.mask ? [prompt.mask] : [])]
      .map((asset, index): UnsupportedCapabilityIssue | undefined => asset.type === 'data' ? undefined : ({
        capability: 'image.edit.asset',
        path: index < prompt.images.length ? `prompt.images[${index}]` : 'prompt.mask',
        remediation: 'Hydrate the edit input to a data asset before generation.',
      }))
      .filter((issue): issue is UnsupportedCapabilityIssue => issue !== undefined)
    if (unsupported.length > 0) {
      throw createUnsupportedCapabilityError({
        adapter: 'ai-sdk',
        model: imageModelId(options.model),
        issues: unsupported as [UnsupportedCapabilityIssue, ...UnsupportedCapabilityIssue[]],
      })
    }

    const nativePrompt = await toNativePrompt(prompt)
    const raw = await gateway.generateImage({
      model: options.model,
      prompt: nativePrompt,
      ...(options.n === undefined ? {} : { n: options.n }),
      ...(options.size === undefined ? {} : { size: options.size }),
      ...(options.aspectRatio === undefined ? {} : { aspectRatio: options.aspectRatio }),
      ...(options.seed === undefined ? {} : { seed: options.seed }),
      ...options.extra,
    })
    return createGeneratedImageResult(
      raw.images.map((image) => ({ data: image.uint8Array, mediaType: image.mediaType })),
      {
        raw,
        usage: {
          images: raw.images.length,
          inputTokens: raw.usage.inputTokens,
          outputTokens: raw.usage.outputTokens,
          totalTokens: raw.usage.totalTokens,
        },
        warnings: raw.warnings,
        providerMetadata: raw.providerMetadata,
        response: raw.responses,
      },
    )
  }
}

async function toNativePrompt(prompt: Awaited<ReturnType<typeof lowerImagePrompt>>): Promise<NativeImageArgs['prompt']> {
  if (prompt.images.length === 0 && !prompt.mask) return prompt.text
  return {
    text: prompt.text,
    images: await Promise.all(prompt.images.map(dataContent)),
    ...(prompt.mask?.type === 'data' ? { mask: await dataContent(prompt.mask) } : {}),
  }
}

async function dataContent(asset: Awaited<ReturnType<typeof lowerImagePrompt>>['images'][number]) {
  if (asset.type !== 'data') throw new TypeError('AI SDK image edits require data assets.')
  return asset.data instanceof Blob ? new Uint8Array(await asset.data.arrayBuffer()) : new Uint8Array(asset.data)
}

function imageModelId(model: ImageModel): string {
  if (typeof model === 'string') return model
  return `${model.provider}/${model.modelId}`
}
