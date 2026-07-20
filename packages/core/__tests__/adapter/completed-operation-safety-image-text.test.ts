/** Direct generated-image prompt text dispatch and media ordering. */

import { describe, expect, it } from 'vitest'
import type { GenerateImageOptions } from '../../src'
import { bindCompletedOperation } from '../../src/adapter'
import { boundary, guardrail } from '../../src/safety'
import { generatedImage, imageInputOperation, secondGeneratedImage } from './completed-operation-safety-image.fixture'

describe('completed operation Safety — generated-image input text', () => {
  it('guards references and mask before exact prompt text and normalization', async () => {
    const events: string[] = []
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
        text: 'original prompt',
        images: [generatedImage, secondGeneratedImage],
        mask: generatedImage,
      },
      guardrails: [
        guardrail({
          id: 'ordered-image-media',
          on: boundary.input.media(),
          run: (subject) => {
            if (subject.origin.kind !== 'operation') return { action: 'allow' }
            events.push(`media:${subject.origin.field}:${subject.origin.partIndex}`)
            return { action: 'allow' }
          },
        }),
        guardrail({
          id: 'ordered-image-text',
          on: boundary.input.user(),
          run: (text, context) => {
            events.push(`text:${context.boundary.id}:${text}`)
            return {
              action: 'rewrite',
              value: 'guarded prompt',
              rewrite: { kind: 'normalize' },
            }
          },
        }),
      ],
    })

    expect(events).toEqual([
      'media:images:0',
      'media:images:1',
      'media:mask:0',
      'text:user.input:original prompt',
      'normalize',
      'invoke',
    ])
    expect(normalized?.prompt).toMatchObject({ text: 'guarded prompt' })
  })

  it('dispatches a direct string only to user input', async () => {
    const boundaries: string[] = []
    const generateImage = bindCompletedOperation({
      definition: imageInputOperation([], () => {}),
      provider: 'test',
      operation: 'generateImage',
    })

    await generateImage({
      model: 'image-model',
      prompt: 'A quiet canal',
      guardrails: [
        guardrail({
          id: 'direct-image-text-boundaries',
          on: [boundary.input.user(), boundary.input.model()] as const,
          run: (_text, context) => {
            boundaries.push(context.boundary.id)
            return { action: 'allow' }
          },
        }),
      ],
    })

    expect(boundaries).toEqual(['user.input'])
  })
})
