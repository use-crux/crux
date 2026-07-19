/** Generated-image Safety through the public completed-operation binder. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindCompletedOperation } from '../../src/adapter'
import { resetHooks, updateHooks } from '../../src'
import { boundary, guardrail, GuardrailBlockedError, type MediaPartSubject } from '../../src/safety'
import { generatedImage, imageOperation } from './completed-operation-safety-image.fixture'

describe('completed operation Safety — generated images', () => {
  afterEach(() => {
    resetHooks()
  })

  it('blocks a selected canonical image before reporting or return', async () => {
    const events: string[] = []
    const report = vi.fn()
    const callback = vi.fn(() => ({
      action: 'block' as const,
      reason: 'Generated image is unsafe.',
    }))
    const policy = guardrail({
      id: 'block-generated-image',
      on: boundary.output.media(),
      run: callback,
    })
    const generateImage = bindCompletedOperation({
      definition: imageOperation(events),
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
    expect(callback).toHaveBeenCalledOnce()
    expect(events).toEqual(['normalize', 'invoke', 'validate'])
    expect(report).not.toHaveBeenCalled()
  })

  it('projects the original image identity with its exact output origin', async () => {
    let seenSubject: MediaPartSubject | undefined
    let seenBoundary: string | undefined
    const policy = guardrail({
      id: 'inspect-generated-image',
      on: boundary.output.media(),
      run: (subject, context) => {
        seenSubject = subject
        seenBoundary = context.boundary.id
        return { action: 'allow' }
      },
    })
    const generateImage = bindCompletedOperation({
      definition: imageOperation([]),
      provider: 'test',
      operation: 'generateImage',
    })

    const result = await generateImage({
      model: 'image-model',
      prompt: 'A quiet canal',
      guardrails: [policy],
    })

    expect(seenSubject).toEqual({
      part: {
        type: 'image',
        source: generatedImage,
        mediaType: 'image/png',
      },
      origin: {
        kind: 'operation',
        operation: 'generateImage',
        phase: 'output',
        field: 'images',
        partIndex: 0,
      },
    })
    expect(seenBoundary).toBe('model.output.media')
    expect(seenSubject?.part.source).toBe(generatedImage)
    expect(result.image).toBe(generatedImage)
    expect(result.safety?.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'inspect-generated-image',
        boundary: 'model.output.media',
        phase: 'output',
        action: 'allow',
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
    expect(Object.isFrozen(result.safety)).toBe(true)
    expect(Object.isFrozen(result.safety?.guardrails?.applied)).toBe(true)
  })

  it('returns a warned image with an attached reason', async () => {
    const policy = guardrail({
      id: 'warn-generated-image',
      on: boundary.output.media(),
      run: () => ({
        action: 'warn',
        reason: 'Generated image needs review.',
      }),
    })
    const generateImage = bindCompletedOperation({
      definition: imageOperation([]),
      provider: 'test',
      operation: 'generateImage',
    })

    const result = await generateImage({
      model: 'image-model',
      prompt: 'A quiet canal',
      guardrails: [policy],
    })

    expect(result.image).toBe(generatedImage)
    expect(result.safety?.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'warn-generated-image',
        action: 'warn',
        reason: 'Generated image needs review.',
      }),
    )
  })

  it('runs a global output-media policy through the same lifecycle', async () => {
    const callback = vi.fn(() => ({ action: 'allow' as const }))
    updateHooks({
      globalGuardrails: [
        guardrail({
          id: 'global-generated-image',
          on: boundary.output.media(),
          run: callback,
        }),
      ],
    })
    const generateImage = bindCompletedOperation({
      definition: imageOperation([]),
      provider: 'test',
      operation: 'generateImage',
    })

    const result = await generateImage({
      model: 'image-model',
      prompt: 'A quiet canal',
    })

    expect(callback).toHaveBeenCalledOnce()
    expect(result.safety?.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'global-generated-image',
        boundary: 'model.output.media',
        action: 'allow',
      }),
    )
  })
})
