/** Generated-image strip semantics through the public completed-operation binder. */

import { describe, expect, it, vi } from 'vitest'
import { type GenerateImageResult } from '../../src'
import { bindCompletedOperation } from '../../src/adapter'
import { boundary, guardrail, GuardrailBlockedError } from '../../src/safety'
import { generatedImage, imageOperation, secondGeneratedImage } from './completed-operation-safety-image.fixture'

describe('completed operation Safety — generated-image strip', () => {
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
