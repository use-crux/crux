import { validateOperationExecution, validateOperationTimeout } from '../completed-operation/contracts'
import type { OperationExecution, OperationTimeout } from '../completed-operation/contracts'
import type { Asset } from '../asset/types'
import type { GenerateImageResult, ImagePrompt, NativeGeneratedImage } from './image-contracts'

/** Tagged failure for a native success response that contains no usable image. */
export type NoImageGeneratedError = Error & {
  readonly name: 'NoImageGeneratedError'
  readonly code: 'no_image_generated'
  readonly cause: unknown
}

/** Metadata preserved while normalizing a provider's successful image result. */
export interface GenerateImageResultFields<TRaw, TProviderMetadata = unknown, TWarning = unknown> {
  readonly raw: TRaw
  readonly warnings: readonly TWarning[]
  readonly providerMetadata?: TProviderMetadata
  readonly execution: OperationExecution
}

/** Validate native bytes and create an ordered, immediately usable image result. */
export function createGeneratedImageResult<TRaw, TProviderMetadata = unknown, TWarning = unknown>(
  nativeImages: readonly NativeGeneratedImage[],
  metadata: GenerateImageResultFields<TRaw, TProviderMetadata, TWarning>,
): GenerateImageResult<TRaw, TProviderMetadata, TWarning> {
  let nonEmpty: [Asset, ...Asset[]]
  try {
    if (nativeImages.length === 0) throw new Error('Native response contained no images.')
    const images = nativeImages.map((image, index) => normalizeImage(image, index))
    nonEmpty = images as [Asset, ...Asset[]]
  } catch (cause) {
    throw createNoImageGeneratedError(cause)
  }
  return Object.freeze({
    image: nonEmpty[0],
    images: Object.freeze(nonEmpty),
    warnings: Object.freeze([...metadata.warnings]),
    execution: validateOperationExecution(metadata.execution),
    raw: metadata.raw,
    ...(metadata.providerMetadata === undefined ? {} : { providerMetadata: metadata.providerMetadata }),
  })
}

/** Narrow unknown failures to the functional no-image tag. */
export function isNoImageGeneratedError(value: unknown): value is NoImageGeneratedError {
  return value !== null && typeof value === 'object' && 'code' in value && value.code === 'no_image_generated'
}

function createNoImageGeneratedError(cause: unknown): NoImageGeneratedError {
  return Object.freeze(Object.assign(new Error('The native image operation returned no usable image.', { cause }), {
    name: 'NoImageGeneratedError' as const,
    code: 'no_image_generated' as const,
    cause,
  }))
}

function normalizeImage(image: NativeGeneratedImage, index: number): Asset {
  if ('type' in image) return validateImageAsset(image, index)
  if (typeof image.mediaType !== 'string' || !/^image\/[a-z0-9.+-]+$/i.test(image.mediaType)) {
    throw new TypeError(`images[${index}].mediaType must be a valid image MIME type.`)
  }
  const data = typeof image.data === 'string' ? decodeBase64(image.data, index) : new Uint8Array(image.data)
  if (data.byteLength === 0) throw new TypeError(`images[${index}].data must not be empty.`)
  return Object.freeze({
    type: 'data' as const,
    data,
    mediaType: image.mediaType,
    ...(image.filename === undefined ? {} : { filename: image.filename }),
  })
}

function validateImageAsset(image: Extract<NativeGeneratedImage, { readonly type: string }>, index: number) {
  if (image.mediaType !== undefined && !/^image\/[a-z0-9.+-]+$/i.test(image.mediaType)) {
    throw new TypeError(`images[${index}].mediaType must be a valid image MIME type.`)
  }
  if (image.type === 'data') {
    if (!image.mediaType.startsWith('image/')) throw new TypeError(`images[${index}].mediaType must be an image MIME type.`)
    if (image.data instanceof Uint8Array && image.data.byteLength === 0) throw new TypeError(`images[${index}].data must not be empty.`)
    if (image.data instanceof Blob && image.data.size === 0) throw new TypeError(`images[${index}].data must not be empty.`)
  }
  return image
}

function decodeBase64(value: string, index: number): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TypeError(`images[${index}].data must be valid base64.`)
  }
  return Uint8Array.from(Buffer.from(value, 'base64'))
}

/** Validate portable image controls before provider I/O. */
export function validateGenerateImageOptions(options: Readonly<{
  prompt?: ImagePrompt
  n?: number
  size?: string
  aspectRatio?: string
  seed?: number
  timeout?: OperationTimeout
}>): void {
  positiveInteger(options.n, 'n')
  if (options.seed !== undefined && (!Number.isSafeInteger(options.seed) || options.seed < 0)) {
    throw new RangeError('Image seed must be a non-negative safe integer.')
  }
  dimensions(options.size, 'size', 'x')
  dimensions(options.aspectRatio, 'aspectRatio', ':')
  if (options.size !== undefined && options.aspectRatio !== undefined) {
    throw new TypeError('Image generation accepts either size or aspectRatio, not both.')
  }
  if (isImagePromptContent(options.prompt) && options.prompt.mask !== undefined && !options.prompt.images?.length) {
    throw new TypeError('An image mask requires at least one reference image.')
  }
  validateOperationTimeout(options.timeout)
}

function isImagePromptContent(prompt: ImagePrompt | undefined): prompt is Extract<ImagePrompt, { readonly text: string }> {
  return prompt !== undefined && typeof prompt !== 'string' && 'text' in prompt
}

function positiveInteger(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw new RangeError(`Image ${name} must be a positive safe integer.`)
  }
}

function dimensions(value: string | undefined, name: string, separator: 'x' | ':'): void {
  if (value === undefined) return
  const [width, height, extra] = value.split(separator).map(Number)
  if (extra !== undefined || !Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0) {
    throw new RangeError(`Image ${name} must contain positive integer dimensions separated by "${separator}".`)
  }
}
