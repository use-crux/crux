/** Routed generated-image operation fixture with model-observable results. */

import {
  createGeneratedImageResult,
  type GenerateImageOptions,
  type GenerateImageResult,
  type NativeGeneratedImage,
} from '../../src'
import { defineCompletedOperation } from '../../src/adapter'
import { generatedImage, secondGeneratedImage } from './completed-operation-safety-image.fixture'

/** Define a generated-image operation whose selected model controls the image. */
export function routedImageOperation(
  invokedModels: string[],
  imagesForModel: (model: string) => NativeGeneratedImage | readonly NativeGeneratedImage[] = (model) =>
    model === 'primary-model' ? generatedImage : secondGeneratedImage,
  onValidate?: (result: GenerateImageResult) => void,
) {
  return defineCompletedOperation({
    normalize: (input: GenerateImageOptions<string>) => input,
    support: () => 'supported' as const,
    invoke: async (_input, context) =>
      context.call('image.generate', async () => {
        invokedModels.push(context.model)
        return Object.freeze({ model: context.model })
      }),
    validate: (raw) => {
      const projected = imagesForModel(raw.model)
      const result = createGeneratedImageResult(Array.isArray(projected) ? projected : [projected], {
        warnings: [],
        providerMetadata: Object.freeze({ model: raw.model }),
        execution: { kind: 'native', calls: 1 },
        raw,
      })
      onValidate?.(result)
      return result
    },
    report: () => ({ kind: 'image' }),
    conformance: [],
  })
}
