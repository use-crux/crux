/** Typed image-prompt fixtures with observable resolution and normalization. */

import {
  createGeneratedImageResult,
  lowerImagePrompt,
  prompt,
  type GenerateImageOptions,
  type ResolvedPrompt,
} from '../../src'
import { defineCompletedOperation } from '../../src/adapter'
import { generatedImage } from './completed-operation-safety-image.fixture'

/** Define an image operation that exercises the provider-facing lowering helper. */
export function loweringImageOperation(
  events: string[],
  onNormalize: (input: GenerateImageOptions<string>, text: string) => void = () => {},
) {
  return defineCompletedOperation({
    async normalize(input: GenerateImageOptions<string>, context) {
      events.push(`normalize:${context.model}`)
      const lowered = await lowerImagePrompt(input, {
        adapter: context.provider,
        model: context.model,
      })
      onNormalize(input, lowered.text)
      return lowered
    },
    support: () => 'supported' as const,
    invoke: async (_input, context) =>
      context.call('image.generate', async () => {
        events.push(`invoke:${context.model}`)
        return Object.freeze({ model: context.model })
      }),
    validate: (raw) =>
      createGeneratedImageResult([generatedImage], {
        warnings: [],
        execution: { kind: 'native', calls: 1 },
        raw,
      }),
    report: () => ({ kind: 'image' }),
    conformance: [],
  })
}

/** Create a structurally real prompt with candidate-controlled resolution. */
export function candidateImagePrompt(resolve: (modelId: string) => ResolvedPrompt | Promise<ResolvedPrompt>) {
  const base = prompt({ id: 'candidate-image-prompt', prompt: 'base prompt' })
  return Object.freeze({
    ...base,
    resolve: (options: Parameters<typeof base.resolve>[0]) => resolve(options.modelId ?? ''),
  }) as typeof base
}
