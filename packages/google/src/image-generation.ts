import type { GenerateImagesConfig, GenerateImagesResponse, GoogleGenAI } from '@google/genai'
import {
  createGeneratedImageResult,
  createUnsupportedCapabilityError,
  lowerImagePrompt,
  validateGenerateImageOptions,
  type GenerateImage,
  type UnsupportedCapabilityIssue,
} from '@use-crux/core'
import { bindCompletedOperation, defineCompletedOperation } from '@use-crux/core/adapter'

/** Google-only Imagen controls forwarded to `models.generateImages()`. */
export type GoogleImageExtra = Omit<GenerateImagesConfig, 'numberOfImages' | 'aspectRatio' | 'seed'> &
  Record<string, unknown>

/**
 * Flat Google image operation attached to a bound adapter.
 *
 * @example
 * ```ts
 * const result = await google.generateImage({ model: 'imagen-4.0-generate-001', prompt: 'A quiet canal' })
 * await assetStore.put(result.image) // optional, explicit persistence
 * ```
 */
export type GoogleGenerateImage = GenerateImage<string, GoogleImageExtra, GenerateImagesResponse>

const GOOGLE_IMAGE_OPERATION_SUPPORT = Object.freeze({
  unsupportedModelPrefixes: Object.freeze(['gemini-', 'text-', 'embedding-', 'imagen-3.0-capability-']),
  common: Object.freeze({
    n: true,
    aspectRatio: true,
    seed: true,
    size: false,
  }),
  edits: false,
})

/** Create one native Google image operation sharing the bound SDK client. */
export function createGoogleGenerateImage(client: GoogleGenAI): GoogleGenerateImage {
  const definition = defineCompletedOperation({
    async normalize(options: Parameters<GoogleGenerateImage>[0]) {
      validateGenerateImageOptions(options)
      const prompt = await lowerImagePrompt(options, {
        adapter: 'google',
        model: options.model,
      })
      const issues = googleImageIssues(options, prompt)
      if (issues.length > 0) {
        throw createUnsupportedCapabilityError({
          adapter: 'google',
          model: options.model,
          issues: issues as [UnsupportedCapabilityIssue, ...UnsupportedCapabilityIssue[]],
        })
      }
      return { options, prompt }
    },
    support: () => 'supported' as const,
    invoke: ({ options, prompt }, { signal }) =>
      client.models.generateImages({
        model: options.model,
        prompt: prompt.text,
        config: {
          ...options.extra,
          abortSignal: signal,
          ...(options.n === undefined ? {} : { numberOfImages: options.n }),
          ...(options.aspectRatio === undefined ? {} : { aspectRatio: options.aspectRatio }),
          ...(options.seed === undefined ? {} : { seed: options.seed }),
        },
      }),
    validate(raw) {
      const generated = raw.generatedImages ?? []
      const images = generated.flatMap((item) =>
        item.image?.imageBytes && item.image.mimeType
          ? [{ data: item.image.imageBytes, mediaType: item.image.mimeType }]
          : [],
      )
      const warnings = generated.flatMap((item) =>
        item.raiFilteredReason ? [`Image blocked: ${item.raiFilteredReason}`] : [],
      )
      const headers = raw.sdkHttpResponse?.headers
      const requestId = headers?.['x-request-id'] ?? headers?.['x-goog-request-id']
      const status = raw.sdkHttpResponse?.responseInternal?.status
      const safety = generated.flatMap((item) =>
        item.safetyAttributes
          ? [
              {
                categories: item.safetyAttributes.categories,
                scores: item.safetyAttributes.scores,
              },
            ]
          : [],
      )
      return createGeneratedImageResult(images, {
        raw,
        warnings,
        execution: { kind: 'native', calls: 1 },
        providerMetadata: {
          ...(requestId === undefined ? {} : { requestId }),
          ...(status === undefined ? {} : { status }),
          ...(safety.length === 0 ? {} : { safety }),
        },
      })
    },
    report: (result) => ({ kind: 'image', count: result.images.length }),
    conformance: [],
  })
  return bindCompletedOperation({
    definition,
    provider: 'google',
    operation: 'generateImage',
  })
}

function googleImageIssues(
  options: Parameters<GoogleGenerateImage>[0],
  prompt: Awaited<ReturnType<typeof lowerImagePrompt>>,
): UnsupportedCapabilityIssue[] {
  const issues: UnsupportedCapabilityIssue[] = []
  if (GOOGLE_IMAGE_OPERATION_SUPPORT.unsupportedModelPrefixes.some((prefix) => options.model.startsWith(prefix))) {
    issues.push(issue('image.model'))
  }
  if (!GOOGLE_IMAGE_OPERATION_SUPPORT.common.size && options.size !== undefined) issues.push(issue('image.size'))
  prompt.images.forEach((_asset, index) => issues.push(issue('image.edit.reference', `prompt.images[${index}]`)))
  if (prompt.mask) issues.push(issue('image.edit.mask', 'prompt.mask'))
  return issues
}

function issue(capability: string, path?: string): UnsupportedCapabilityIssue {
  return {
    capability,
    ...(path === undefined ? {} : { path }),
    remediation: 'Use a native Imagen generation model and Google-supported generation controls.',
  }
}
