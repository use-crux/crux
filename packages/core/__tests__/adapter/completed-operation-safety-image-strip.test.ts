/** Generated-image strip semantics through the public completed-operation binder. */

import { describe, expect, it, vi } from 'vitest'
import { type GenerateImageResult } from '../../src'
import { bindCompletedOperation } from '../../src/adapter'
import { boundary, guardrail, GuardrailBlockedError } from '../../src/safety'
import { generatedImage, imageOperation, secondGeneratedImage } from './completed-operation-safety-image.fixture'

describe('completed operation Safety — generated-image strip', () => {
  it('runs policies in image-major order and skips later policies after strip', async () => {
    const callbacks: string[] = []
    const first = guardrail({
      id: 'first-image-policy',
      on: boundary.output.media(),
      run: (subject) => {
        callbacks.push(`${operationPartIndex(subject)}:first`)
        return { action: 'allow' }
      },
    })
    const second = guardrail({
      id: 'second-image-policy',
      on: boundary.output.media(),
      run: (subject) => {
        const partIndex = operationPartIndex(subject)
        callbacks.push(`${partIndex}:second`)
        return partIndex === 0
          ? { action: 'strip', reason: 'Remove the first image.' }
          : { action: 'allow' }
      },
    })
    const third = guardrail({
      id: 'third-image-policy',
      on: boundary.output.media(),
      run: (subject) => {
        callbacks.push(`${operationPartIndex(subject)}:third`)
        return { action: 'warn', reason: 'Review the retained image.' }
      },
    })
    const generateImage = bindCompletedOperation({
      definition: imageOperation([], [generatedImage, secondGeneratedImage]),
      provider: 'test',
      operation: 'generateImage',
    })

    const result = await generateImage({
      model: 'image-model',
      prompt: 'A quiet canal',
      guardrails: [first, second, third],
    })

    expect(callbacks).toEqual([
      '0:first',
      '0:second',
      '1:first',
      '1:second',
      '1:third',
    ])
    expect(result.images).toEqual([secondGeneratedImage])
    expect(result.safety?.guardrails?.applied.map((entry) => [entry.guard, entry.action])).toEqual([
      ['first-image-policy', 'allow'],
      ['second-image-policy', 'strip'],
      ['first-image-policy', 'allow'],
      ['second-image-policy', 'allow'],
      ['third-image-policy', 'warn'],
    ])
  })

  it('attributes final-image escalation to the terminal policy and original image', async () => {
    const firstStrip = guardrail({
      id: 'strip-original-first-image',
      on: boundary.output.media(),
      run: (subject) =>
        operationPartIndex(subject) === 0
          ? { action: 'strip', reason: 'Remove original image zero.' }
          : { action: 'allow' },
    })
    const finalStrip = guardrail({
      id: 'strip-original-second-image',
      on: boundary.output.media(),
      run: (subject) =>
        operationPartIndex(subject) === 1
          ? { action: 'strip', reason: 'Remove original image one.' }
          : { action: 'allow' },
    })
    const generateImage = bindCompletedOperation({
      definition: imageOperation([], [generatedImage, secondGeneratedImage]),
      provider: 'test',
      operation: 'generateImage',
    })

    const error = await generateImage({
      model: 'image-model',
      prompt: 'A quiet canal',
      guardrails: [firstStrip, finalStrip],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect(error).toMatchObject({
      guardrailId: 'strip-original-second-image',
      reason: 'Remove original image one.',
      decisions: [
        {
          policyId: 'strip-original-second-image',
          boundary: 'model.output.media',
          action: 'block',
          location: {
            origin: {
              kind: 'operation',
              operation: 'generateImage',
              phase: 'output',
              field: 'images',
              partIndex: 1,
            },
            partType: 'image',
          },
        },
      ],
    })
  })

  it('strips one sibling and resets the image alias', async () => {
    let validated: GenerateImageResult | undefined
    const policy = guardrail({
      id: 'strip-first-generated-image',
      on: boundary.output.media(),
      run: (subject) =>
        subject.origin.kind === 'operation' && subject.origin.partIndex === 0
          ? { action: 'strip', reason: 'Remove the first image.' }
          : { action: 'allow' },
    })
    const generateImage = bindCompletedOperation({
      definition: imageOperation([], [generatedImage, secondGeneratedImage], (result) => {
        validated = result
      }),
      provider: 'test',
      operation: 'generateImage',
    })

    const result = await generateImage({
      model: 'image-model',
      prompt: 'A quiet canal',
      guardrails: [policy],
    })

    expect(result.images).toEqual([secondGeneratedImage])
    expect(result.images[0]).toBe(secondGeneratedImage)
    expect(result.image).toBe(secondGeneratedImage)
    expect(result).not.toBe(validated)
    expect(result.raw).toBe(validated?.raw)
    expect(result.providerMetadata).toBe(validated?.providerMetadata)
    expect(result.execution).toEqual(validated?.execution)
    expect(validated?.images).toEqual([generatedImage, secondGeneratedImage])
    expect(Object.isFrozen(validated)).toBe(true)
    expect(Object.isFrozen(validated?.images)).toBe(true)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.images)).toBe(true)
    expect(result.safety?.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'strip-first-generated-image',
        action: 'strip',
        location: {
          origin: {
            kind: 'operation',
            operation: 'generateImage',
            phase: 'output',
            field: 'images',
            partIndex: 0,
          },
          partType: 'image',
        },
      }),
    )
  })

  it('escalates stripping the final image to a block', async () => {
    const report = vi.fn()
    const policy = guardrail({
      id: 'strip-final-generated-image',
      on: boundary.output.media(),
      run: () => ({ action: 'strip', reason: 'Remove the final image.' }),
    })
    const generateImage = bindCompletedOperation({
      definition: imageOperation([]),
      provider: 'test',
      operation: 'generateImage',
      onReport: report,
    })

    const error = await generateImage({
      model: 'image-model',
      prompt: 'A quiet canal',
      guardrails: [policy],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect(error).toMatchObject({
      guardrailId: 'strip-final-generated-image',
      phase: 'output',
      reason: 'Remove the final image.',
      decisions: [
        {
          policyId: 'strip-final-generated-image',
          boundary: 'model.output.media',
          action: 'block',
          location: {
            origin: {
              kind: 'operation',
              operation: 'generateImage',
              phase: 'output',
              field: 'images',
              partIndex: 0,
            },
            partType: 'image',
          },
        },
      ],
    })
    expect(report).not.toHaveBeenCalled()
  })

  it('reports strip intent without changing either image alias', async () => {
    let validated: GenerateImageResult | undefined
    const policy = guardrail({
      id: 'report-generated-image-strip',
      on: boundary.output.media(),
      mode: 'report',
      run: () => ({ action: 'strip', reason: 'Would remove this image.' }),
    })
    const generateImage = bindCompletedOperation({
      definition: imageOperation([], [generatedImage, secondGeneratedImage], (result) => {
        validated = result
      }),
      provider: 'test',
      operation: 'generateImage',
    })

    const result = await generateImage({
      model: 'image-model',
      prompt: 'A quiet canal',
      guardrails: [policy],
    })

    expect(result.images).toBe(validated?.images)
    expect(result.image).toBe(validated?.image)
    expect(result.safety?.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'report-generated-image-strip',
        mode: 'report',
        action: 'strip',
        reason: 'Would remove this image.',
      }),
    )
  })
})

function operationPartIndex(subject: Parameters<ReturnType<typeof guardrail.media>>[0]): number {
  if (subject.origin.kind !== 'operation') throw new Error('Expected operation origin.')
  return subject.origin.partIndex
}
