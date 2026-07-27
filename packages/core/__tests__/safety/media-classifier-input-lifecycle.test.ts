import { describe, expect, it } from 'vitest'
import { bindCompletedOperation } from '../../src/adapter'
import { boundary, createSafety, guardrail } from '../../src/safety'
import {
  generatedImage,
  imageInputOperation,
  secondGeneratedImage,
} from '../adapter/completed-operation-safety-image.fixture'
import { classifierHarness } from './media-classifier-lifecycle.fixtures'

describe('media classifier input lifecycle', () => {
  it('classifies every canonical media kind once in stable traversal order', async () => {
    const harness = classifierHarness()
    const policy = guardrail({
      id: 'input-media-classifier',
      on: boundary.input.media(),
      run: harness.run,
    })
    const safety = createSafety({ call: { guardrails: [policy] } })
    const messages = [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: 'First.' },
          {
            type: 'image' as const,
            source: 'https://example.com/image.png',
            mediaType: 'image/png',
          },
          {
            type: 'audio' as const,
            source: new Uint8Array([1, 2]),
            mediaType: 'audio/wav',
          },
        ],
      },
      { role: 'assistant' as const, content: 'Between.' },
      {
        role: 'user' as const,
        content: [
          {
            type: 'video' as const,
            source: 'https://example.com/video.mp4',
            mediaType: 'video/mp4',
          },
          {
            type: 'file' as const,
            source: new Uint8Array([3, 4]),
            mediaType: 'application/pdf',
            filename: 'document.pdf',
          },
        ],
      },
    ]

    const result = await safety.guardInput({ messages })

    expect(result.messages).toBe(messages)
    expect(harness.parts.map((part) => part.type)).toEqual([
      'image',
      'audio',
      'video',
      'file',
    ])
    expect(harness.models).toEqual([
      'classifier-model',
      'classifier-model',
      'classifier-model',
      'classifier-model',
    ])
    expect(
      safety.audit.guardrails?.applied.map((entry) => entry.location),
    ).toEqual([
      {
        origin: { kind: 'message', messageIndex: 0, partIndex: 1 },
        partType: 'image',
      },
      {
        origin: { kind: 'message', messageIndex: 0, partIndex: 2 },
        partType: 'audio',
      },
      {
        origin: { kind: 'message', messageIndex: 2, partIndex: 0 },
        partType: 'video',
      },
      {
        origin: { kind: 'message', messageIndex: 2, partIndex: 1 },
        partType: 'file',
      },
    ])
  })

  it('skips an excluded part without preventing a later included call', async () => {
    const harness = classifierHarness({ modalities: ['image'] })
    const policy = guardrail({
      id: 'image-only-classifier',
      on: boundary.input.media(),
      run: harness.run,
    })
    const safety = createSafety({ call: { guardrails: [policy] } })
    const imageSource = new Uint8Array([7, 8])

    await safety.guardInput({
      messages: [{
        role: 'user',
        content: [
          {
            type: 'file',
            source: 'https://example.com/excluded.pdf',
            filename: 'excluded.pdf',
          },
          { type: 'image', source: imageSource },
        ],
      }],
    })

    expect(harness.calls).toBe(1)
    expect(harness.parts).toEqual([{ type: 'image', source: imageSource }])
    expect(
      safety.audit.guardrails?.applied.map((entry) => [
        entry.location?.partType,
        entry.action,
      ]),
    ).toEqual([
      ['file', 'allow'],
      ['image', 'allow'],
    ])
  })

  it('attributes a retained-mask dependency failure to the final stripped reference', async () => {
    const mask = Object.freeze({
      type: 'data' as const,
      data: new Uint8Array([7, 8, 9]),
      mediaType: 'image/png',
    })
    const harness = classifierHarness({
      action: 'strip',
      score: (part) => part.source === mask ? 0 : 0.9,
    })
    const generateImage = bindCompletedOperation({
      definition: imageInputOperation([], () => {}),
      provider: 'test',
      operation: 'generateImage',
    })

    const error = await generateImage({
      model: 'image-model',
      prompt: {
        text: 'Edit the canal',
        images: [generatedImage, secondGeneratedImage],
        mask,
      },
      guardrails: [guardrail({
        id: 'classify-edit-dependency',
        on: boundary.input.media(),
        run: harness.run,
      })],
    }).then(() => undefined, (caught: unknown) => caught)

    expect(harness.calls).toBe(3)
    expect(error).toMatchObject({
      decisions: [{
        action: 'block',
        escalatedToBlock: true,
        location: {
          origin: {
            operation: 'generateImage',
            phase: 'input',
            field: 'images',
            partIndex: 1,
          },
          partType: 'image',
        },
        findings: [{
          type: 'media_classifier_match',
          category: 'unsafe',
          score: 0.9,
          threshold: 0.8,
        }],
      }],
    })
  })
})
