/** Generated-image Safety placement around completed-operation routing. */

import { describe, expect, it, vi } from 'vitest'
import { fallback, type GenerateImageResult } from '../../src'
import { bindCompletedOperation } from '../../src/adapter'
import { router } from '../../src/routing'
import { boundary, guardrail, GuardrailBlockedError } from '../../src/safety'
import { generatedImage, imageOperation, secondGeneratedImage } from './completed-operation-safety-image.fixture'
import { routedImageOperation } from './completed-operation-safety-image-routing.fixture'

describe('completed operation Safety — generated-image routing', () => {
  it('runs output media exactly once on the router-selected result', async () => {
    const callback = vi.fn(() => ({ action: 'allow' as const }))
    const generateImage = bindCompletedOperation({
      definition: imageOperation([]),
      provider: 'test',
      operation: 'generateImage',
    })

    const result = await generateImage({
      model: router({
        classify: () => 'selected' as const,
        routes: { selected: 'selected-model', default: 'default-model' },
      }),
      prompt: 'A quiet canal',
      guardrails: [
        guardrail({
          id: 'selected-image-policy',
          on: boundary.output.media(),
          run: callback,
        }),
      ],
    })

    expect(result.image).toBe(generatedImage)
    expect(callback).toHaveBeenCalledOnce()
  })

  it('runs fallback result predicates before Safety on each candidate', async () => {
    const invokedModels: string[] = []
    const predicateResults: unknown[] = []
    const callback = vi.fn(() => ({ action: 'allow' as const }))
    const generateImage = bindCompletedOperation({
      definition: routedImageOperation(invokedModels),
      provider: 'test',
      operation: 'generateImage',
    })

    const result = await generateImage({
      model: fallback(['primary-model', 'selected-model'], {
        when: (candidate) => {
          predicateResults.push(candidate)
          if (!isImageCandidate(candidate)) throw new Error('Expected generated-image candidate.')
          expect(candidate.safety).toBeUndefined()
          return candidate.image === generatedImage
        },
      }),
      prompt: 'A quiet canal',
      guardrails: [
        guardrail({
          id: 'selected-fallback-image-policy',
          on: boundary.output.media(),
          run: callback,
        }),
      ],
    })

    expect(invokedModels).toEqual(['primary-model', 'selected-model'])
    expect(predicateResults).toHaveLength(2)
    expect(callback).toHaveBeenCalledOnce()
    expect(result.image).not.toBe(generatedImage)
    expect(result.safety?.guardrails?.applied).toHaveLength(1)
  })

  it('does not fallback after output Safety blocks the selected result', async () => {
    const invokedModels: string[] = []
    const transitions: string[] = []
    const generateImage = bindCompletedOperation({
      definition: routedImageOperation(invokedModels),
      provider: 'test',
      operation: 'generateImage',
    })

    const error = await generateImage({
      model: fallback(['primary-model', 'unused-model'], {
        onFallback: ({ from, to }) => transitions.push(`${from}->${to}`),
      }),
      prompt: 'A quiet canal',
      guardrails: [
        guardrail({
          id: 'terminal-selected-image-policy',
          on: boundary.output.media(),
          run: () => ({ action: 'block', reason: 'Selected image is unsafe.' }),
        }),
      ],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect(invokedModels).toEqual(['primary-model'])
    expect(transitions).toEqual([])
  })

  it('does not fallback after a selected result strip escalates to block', async () => {
    const invokedModels: string[] = []
    const transitions: string[] = []
    const generateImage = bindCompletedOperation({
      definition: routedImageOperation(invokedModels),
      provider: 'test',
      operation: 'generateImage',
    })

    const error = await generateImage({
      model: fallback(['primary-model', 'unused-model'], {
        onFallback: ({ from, to }) => transitions.push(`${from}->${to}`),
      }),
      prompt: 'A quiet canal',
      guardrails: [
        guardrail({
          id: 'terminal-selected-strip-policy',
          on: boundary.output.media(),
          run: () => ({ action: 'strip', reason: 'Remove selected image.' }),
        }),
      ],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect(invokedModels).toEqual(['primary-model'])
    expect(transitions).toEqual([])
  })

  it('reports the router-selected model to output media policies', async () => {
    const invokedModels: string[] = []
    const observedModels: Array<string | undefined> = []
    const generateImage = bindCompletedOperation({
      definition: routedImageOperation(invokedModels),
      provider: 'test',
      operation: 'generateImage',
    })

    await generateImage({
      model: fallback(['primary-model', 'selected-model'], {
        when: (candidate) => {
          if (!isImageCandidate(candidate)) throw new Error('Expected generated-image candidate.')
          return candidate.image === generatedImage
        },
      }),
      prompt: 'A quiet canal',
      guardrails: [
        guardrail({
          id: 'selected-model-context-policy',
          on: boundary.output.media(),
          run: (_subject, context) => {
            observedModels.push(context.model.id)
            return { action: 'allow' }
          },
        }),
      ],
    })

    expect(invokedModels).toEqual(['primary-model', 'selected-model'])
    expect(observedModels).toEqual(['selected-model'])
  })

  it('preserves selected provider identities through immutable strip write-back', async () => {
    const invokedModels: string[] = []
    let validated: GenerateImageResult | undefined
    const generateImage = bindCompletedOperation({
      definition: routedImageOperation(
        invokedModels,
        () => [generatedImage, secondGeneratedImage],
        (result) => {
          validated = result
        },
      ),
      provider: 'test',
      operation: 'generateImage',
    })

    const result = await generateImage({
      model: router({
        classify: () => 'selected' as const,
        routes: { selected: 'selected-model', default: 'default-model' },
      }),
      prompt: 'A quiet canal',
      guardrails: [
        guardrail({
          id: 'routed-identity-strip-policy',
          on: boundary.output.media(),
          run: (subject) =>
            subject.origin.partIndex === 0
              ? { action: 'strip', reason: 'Remove the first image.' }
              : { action: 'allow' },
        }),
      ],
    })

    if (!validated) throw new Error('Expected routed result validation.')
    expect(invokedModels).toEqual(['selected-model'])
    expect(result.raw).toBe(validated.raw)
    expect(result.providerMetadata).toBe(validated.providerMetadata)
    expect(result.image).toBe(secondGeneratedImage)
    expect(result.image).toBe(result.images[0])
    expect(result.images).toHaveLength(1)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.images)).toBe(true)
  })
})

function isImageCandidate(value: unknown): value is {
  readonly image: unknown
  readonly safety?: unknown
} {
  return typeof value === 'object' && value !== null && 'image' in value
}
