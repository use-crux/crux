import { toFile, type Uploadable } from 'openai'
import type OpenAI from 'openai'
import type { ImagesResponse } from 'openai/resources/images'
import type { ImageEditParamsNonStreaming } from 'openai/resources/images'
import {
  createGeneratedImageResult,
  createUnsupportedCapabilityError,
  lowerImagePrompt,
  validateGenerateImageOptions,
  type GenerateImage,
  type NativeGeneratedImage,
  type UnsupportedCapabilityIssue,
} from '@use-crux/core'
import { bindCompletedOperation, defineCompletedOperation } from '@use-crux/core/adapter'

/** OpenAI-only image controls forwarded to the native Images API. */
export interface OpenAIImageExtra extends Record<string, unknown> {
  readonly background?: 'transparent' | 'opaque' | 'auto' | null
  readonly input_fidelity?: 'high' | 'low' | null
  readonly moderation?: 'low' | 'auto' | null
  readonly output_compression?: number | null
  readonly output_format?: 'png' | 'jpeg' | 'webp' | null
  readonly quality?: 'standard' | 'hd' | 'low' | 'medium' | 'high' | 'auto' | null
  readonly user?: string
}

/**
 * Flat OpenAI image operation attached to a bound adapter.
 *
 * @example
 * ```ts
 * const result = await openai.generateImage({ model: 'gpt-image-1', prompt: 'A quiet canal' })
 * await assetStore.put(result.image) // optional, explicit persistence
 * ```
 */
export type OpenAIGenerateImage = GenerateImage<string, OpenAIImageExtra, ImagesResponse>

/** Create one stateless OpenAI image operation sharing the bound SDK client. */
export function createOpenAIGenerateImage(client: OpenAI): OpenAIGenerateImage {
  const definition = defineCompletedOperation({
    async normalize(options: Parameters<OpenAIGenerateImage>[0]) {
      validateGenerateImageOptions(options)
      const prompt = await lowerImagePrompt(options, {
        adapter: 'openai',
        model: options.model,
      })
      const issues = openAIImageIssues(options, prompt)
      if (issues.length > 0) {
        throw createUnsupportedCapabilityError({
          adapter: 'openai',
          model: options.model,
          issues: issues as [UnsupportedCapabilityIssue, ...UnsupportedCapabilityIssue[]],
        })
      }
      return { options, prompt }
    },
    support: () => 'supported' as const,
    async invoke({ options, prompt }, { signal }) {
      return prompt.images.length > 0 || prompt.mask
        ? client.images.edit(
            {
              ...options.extra,
              model: options.model,
              prompt: prompt.text,
              image: await Promise.all(prompt.images.map((asset, index) => dataAssetFile(asset, `image-${index}`))),
              ...(prompt.mask === undefined ? {} : { mask: await dataAssetFile(prompt.mask, 'mask') }),
              ...(options.n === undefined ? {} : { n: options.n }),
              ...(options.size === undefined ? {} : { size: options.size }),
              response_format: 'b64_json',
              stream: false,
            } as ImageEditParamsNonStreaming,
            { signal },
          )
        : client.images.generate(
            {
              ...options.extra,
              model: options.model,
              prompt: prompt.text,
              ...(options.n === undefined ? {} : { n: options.n }),
              ...(options.size === undefined ? {} : { size: options.size }),
              response_format: 'b64_json',
              stream: false,
            },
            { signal },
          )
    },
    validate(raw, { options }) {
      const mediaType = outputMediaType(raw.output_format ?? options.extra?.output_format)
      const images: NativeGeneratedImage[] = (raw.data ?? []).flatMap((image) =>
        image.b64_json ? [{ data: image.b64_json, mediaType }] : [],
      )
      return createGeneratedImageResult(images, {
        raw,
        warnings: [],
        execution: { kind: 'native', calls: 1 },
        providerMetadata: {
          created: raw.created,
          ...(raw.background === undefined ? {} : { background: raw.background }),
          ...(raw.quality === undefined ? {} : { quality: raw.quality }),
          ...(raw.size === undefined ? {} : { size: raw.size }),
        },
      })
    },
    report: (result) => ({ kind: 'image', count: result.images.length }),
    conformance: [],
  })
  return bindCompletedOperation({
    definition,
    provider: 'openai',
    operation: 'generateImage',
  })
}

function openAIImageIssues(
  options: Parameters<OpenAIGenerateImage>[0],
  prompt: Awaited<ReturnType<typeof lowerImagePrompt>>,
): UnsupportedCapabilityIssue[] {
  const issues: UnsupportedCapabilityIssue[] = []
  if (options.aspectRatio !== undefined) issues.push(issue('image.aspectRatio'))
  if (options.seed !== undefined) issues.push(issue('image.seed'))
  if (options.n !== undefined && (options.n > 10 || (options.model === 'dall-e-3' && options.n > 1))) {
    issues.push(issue('image.n'))
  }
  if ((prompt.images.length > 0 || prompt.mask) && options.extra?.quality === 'hd')
    issues.push(issue('image.edit.quality'))
  prompt.images.forEach((asset, index) => {
    if (asset.type !== 'data') issues.push(issue('image.edit.reference', `prompt.images[${index}]`))
  })
  if (prompt.mask?.type !== undefined && prompt.mask.type !== 'data')
    issues.push(issue('image.edit.mask', 'prompt.mask'))
  return issues
}

function issue(capability: string, path?: string): UnsupportedCapabilityIssue {
  return {
    capability,
    ...(path === undefined ? {} : { path }),
    remediation: 'Use native OpenAI image controls and byte assets.',
  }
}

async function dataAssetFile(
  asset: Awaited<ReturnType<typeof lowerImagePrompt>>['images'][number],
  name: string,
): Promise<Uploadable> {
  if (asset.type !== 'data') throw new TypeError('OpenAI edits require data assets.')
  return toFile(asset.data, asset.filename ?? name, { type: asset.mediaType })
}

function outputMediaType(format: string | null | undefined): string {
  return format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png'
}
