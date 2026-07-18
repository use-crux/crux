/** Shared completed-image operation fixtures for Safety integration tests. */

import {
  createGeneratedImageResult,
  type GenerateImageOptions,
  type GenerateImageResult,
  type NativeGeneratedImage,
} from '../../src'
import { defineCompletedOperation } from '../../src/adapter'

export const generatedImage = Object.freeze({
  type: 'data' as const,
  data: new Uint8Array([1, 2, 3]),
  mediaType: 'image/png',
})

export const secondGeneratedImage = Object.freeze({
  type: 'data' as const,
  data: new Uint8Array([4, 5, 6]),
  mediaType: 'image/png',
})

/** Defines a deterministic generated-image operation with observable lifecycle events. */
export function imageOperation(
  events: string[],
  images: readonly NativeGeneratedImage[] = [generatedImage],
  onValidate?: (result: GenerateImageResult) => void,
) {
  return defineCompletedOperation({
    normalize(input: GenerateImageOptions<string>) {
      events.push('normalize')
      return input
    },
    support: () => 'supported' as const,
    invoke: async (_input, context) =>
      context.call('image.generate', async () => {
        events.push('invoke')
        return { requestId: 'request-1' }
      }),
    validate(raw) {
      events.push('validate')
      const result = createGeneratedImageResult(images, {
        warnings: [],
        providerMetadata: { requestId: raw.requestId },
        execution: { kind: 'native', calls: 1 },
        raw,
      })
      onValidate?.(result)
      return result
    },
    report: () => {
      events.push('report')
      return { kind: 'image' }
    },
    conformance: [],
  })
}

/** Defines an image operation that exposes its first normalized input. */
export function imageInputOperation(
  events: string[],
  onNormalize: (input: GenerateImageOptions<string>) => void,
) {
  return defineCompletedOperation({
    normalize(input: GenerateImageOptions<string>) {
      events.push('normalize')
      onNormalize(input)
      return input
    },
    support: () => 'supported' as const,
    invoke: async (_input, context) =>
      context.call('image.generate', async () => {
        events.push('invoke')
        return Object.freeze({ requestId: 'request-1' })
      }),
    validate: (raw) => createGeneratedImageResult([generatedImage], {
      warnings: [],
      providerMetadata: Object.freeze({ requestId: raw.requestId }),
      execution: { kind: 'native', calls: 1 },
      raw,
    }),
    report: () => ({ kind: 'image' }),
    conformance: [],
  })
}
