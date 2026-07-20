/** Generated-image input Safety before provider normalization. */

import { describe, expect, it } from 'vitest'
import type { GenerateImageOptions } from '../../src'
import { bindCompletedOperation } from '../../src/adapter'
import { boundary, guardrail, GuardrailBlockedError } from '../../src/safety'
import { generatedImage, imageInputOperation, secondGeneratedImage } from './completed-operation-safety-image.fixture'

const editMask = Object.freeze({
  type: 'data' as const,
  data: new Uint8Array([7, 8, 9]),
  mediaType: 'image/png',
})

describe('completed operation Safety — generated-image input', () => {
  it('strips direct references and mask before provider normalization', async () => {
    const events: string[] = []
    const origins: string[] = []
    let normalized: GenerateImageOptions<string> | undefined
    const generateImage = bindCompletedOperation({
      definition: imageInputOperation(events, (input) => {
        normalized = input
      }),
      provider: 'test',
      operation: 'generateImage',
    })

    await generateImage({
      model: 'image-model',
      prompt: {
        text: 'Edit the canal',
        images: [generatedImage, secondGeneratedImage],
        mask: editMask,
      },
      guardrails: [
        guardrail({
          id: 'image-input-strip-policy',
          on: boundary.input.media(),
          run: (subject) => {
            const { field, partIndex } =
              subject.origin.kind === 'operation' ? subject.origin : { field: 'unexpected', partIndex: -1 }
            origins.push(`${field}:${partIndex}`)
            events.push(`guard:${field}:${partIndex}`)
            return field === 'mask' || partIndex === 0
              ? { action: 'strip', reason: 'Remove edit asset.' }
              : { action: 'allow' }
          },
        }),
      ],
    })

    expect(origins).toEqual(['images:0', 'images:1', 'mask:0'])
    expect(events.slice(0, 4)).toEqual(['guard:images:0', 'guard:images:1', 'guard:mask:0', 'normalize'])
    expect(normalized?.prompt).toEqual({
      text: 'Edit the canal',
      images: [secondGeneratedImage],
    })
    if (typeof normalized?.prompt !== 'object' || !('images' in normalized.prompt)) {
      throw new Error('Expected normalized direct image prompt.')
    }
    expect(normalized.prompt.images?.[0]).toBe(secondGeneratedImage)
    expect(Object.isFrozen(normalized)).toBe(true)
    expect(Object.isFrozen(normalized.prompt)).toBe(true)
  })

  it('attributes a retained-mask dependency block to the last reference strip', async () => {
    const events: string[] = []
    const generateImage = bindCompletedOperation({
      definition: imageInputOperation(events, () => {}),
      provider: 'test',
      operation: 'generateImage',
    })

    const error = await generateImage({
      model: 'image-model',
      prompt: {
        text: 'Edit the canal',
        images: [generatedImage, secondGeneratedImage],
        mask: editMask,
      },
      guardrails: [
        guardrail({
          id: 'reference-dependency-policy',
          on: boundary.input.media(),
          run: (subject) => {
            if (subject.origin.kind !== 'operation') return { action: 'allow' }
            events.push(`guard:${subject.origin.field}:${subject.origin.partIndex}`)
            return subject.origin.field === 'images'
              ? {
                  action: 'strip',
                  reason: `Remove reference ${subject.origin.partIndex}.`,
                }
              : { action: 'allow' }
          },
        }),
      ],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    if (!(error instanceof GuardrailBlockedError)) throw error
    expect(error.guardrailId).toBe('reference-dependency-policy')
    expect(error.reason).toBe('Remove reference 1.')
    expect(error.decisions[0]).toMatchObject({
      action: 'block',
      location: {
        origin: {
          kind: 'operation',
          operation: 'generateImage',
          phase: 'input',
          field: 'images',
          partIndex: 1,
        },
        partType: 'image',
      },
    })
    expect(events).toEqual(['guard:images:0', 'guard:images:1', 'guard:mask:0'])
  })

  it('allows stripping only the mask while retaining reference identity', async () => {
    let normalized: GenerateImageOptions<string> | undefined
    const generateImage = bindCompletedOperation({
      definition: imageInputOperation([], (input) => {
        normalized = input
      }),
      provider: 'test',
      operation: 'generateImage',
    })

    await generateImage({
      model: 'image-model',
      prompt: {
        text: 'Edit the canal',
        images: [generatedImage],
        mask: editMask,
      },
      guardrails: [
        guardrail({
          id: 'mask-only-strip-policy',
          on: boundary.input.media(),
          run: (subject) =>
            subject.origin.kind === 'operation' && subject.origin.field === 'mask'
              ? { action: 'strip', reason: 'Remove the mask.' }
              : { action: 'allow' },
        }),
      ],
    })

    expect(normalized?.prompt).toEqual({
      text: 'Edit the canal',
      images: [generatedImage],
    })
    if (typeof normalized?.prompt !== 'object' || !('images' in normalized.prompt)) {
      throw new Error('Expected normalized direct image prompt.')
    }
    expect(normalized.prompt.images?.[0]).toBe(generatedImage)
  })

  it('allows stripping every reference when no mask remains', async () => {
    let normalized: GenerateImageOptions<string> | undefined
    const generateImage = bindCompletedOperation({
      definition: imageInputOperation([], (input) => {
        normalized = input
      }),
      provider: 'test',
      operation: 'generateImage',
    })

    await generateImage({
      model: 'image-model',
      prompt: {
        text: 'Draw the canal',
        images: [generatedImage, secondGeneratedImage],
      },
      guardrails: [
        guardrail({
          id: 'all-reference-strip-policy',
          on: boundary.input.media(),
          run: () => ({ action: 'strip', reason: 'Remove the reference.' }),
        }),
      ],
    })

    expect(normalized?.prompt).toEqual({ text: 'Draw the canal' })
  })

  it('preserves direct prompt identities for report-mode strip', async () => {
    const prompt = Object.freeze({
      text: 'Edit the canal',
      images: Object.freeze([generatedImage] as const),
      mask: editMask,
    })
    let normalized: GenerateImageOptions<string> | undefined
    const generateImage = bindCompletedOperation({
      definition: imageInputOperation([], (input) => {
        normalized = input
      }),
      provider: 'test',
      operation: 'generateImage',
    })

    const result = await generateImage({
      model: 'image-model',
      prompt,
      guardrails: [
        guardrail({
          id: 'report-image-input-strip-policy',
          mode: 'report',
          on: boundary.input.media(),
          run: () => ({ action: 'strip', reason: 'Would remove edit media.' }),
        }),
      ],
    })

    expect(normalized?.prompt).toBe(prompt)
    expect(
      typeof normalized?.prompt === 'object' && 'images' in normalized.prompt ? normalized.prompt.images : undefined,
    ).toBe(prompt.images)
    expect(result.safety?.guardrails?.applied).toHaveLength(2)
    expect(result.safety?.guardrails?.applied.map(({ action, mode }) => ({ action, mode }))).toEqual([
      { action: 'strip', mode: 'report' },
      { action: 'strip', mode: 'report' },
    ])
  })
})
