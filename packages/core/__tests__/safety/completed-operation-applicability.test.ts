/** Completed-operation Safety boundary applicability. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { fallback, resetHooks, setHooks } from '../../src'
import { bindCompletedOperation } from '../../src/adapter'
import { boundary, guardrail, SafetyConfigError } from '../../src/safety'
import { imageOperation } from '../adapter/completed-operation-safety-image.fixture'
import { speechOperation } from '../adapter/completed-operation-safety-speech.fixture'
import { inputAudio, transcriptionOperation } from '../adapter/completed-operation-safety-transcription.fixture'

afterEach(() => resetHooks())

describe('completed-operation Safety applicability', () => {
  it('rejects an inapplicable call-scoped image binding before normalization', async () => {
    const events: string[] = []
    const generateImage = bindCompletedOperation({
      definition: imageOperation(events),
      provider: 'test',
      operation: 'generateImage',
    })

    const error = await generateImage({
      model: 'image-model',
      prompt: 'A quiet canal',
      guardrails: [
        guardrail({
          id: 'image-transcript-policy',
          on: boundary.output.text(),
          run: () => ({ action: 'allow' }),
        }),
      ],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(SafetyConfigError)
    expect(error).toMatchObject({
      boundaries: ['model.output.text'],
      kinds: ['guardrail'],
      scopes: ['call'],
    })
    expect(events).toEqual([])
  })

  it('rejects one inapplicable local binding for speech and transcription', async () => {
    const speechEvents: string[] = []
    const transcriptionEvents: string[] = []
    const generateSpeech = bindCompletedOperation({
      definition: speechOperation(speechEvents),
      provider: 'test',
      operation: 'generateSpeech',
    })
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation(transcriptionEvents),
      provider: 'test',
      operation: 'transcribe',
    })
    const speechError = await generateSpeech({
      model: 'speech-model',
      text: 'Read this.',
      guardrails: [
        guardrail({
          id: 'speech-media-input',
          on: boundary.input.media(),
          run: () => ({ action: 'allow' }),
        }),
      ],
    }).catch((error: unknown) => error)
    const transcriptionError = await transcribe({
      model: 'transcription-model',
      audio: inputAudio,
      guardrails: [
        guardrail({
          id: 'transcription-model-input',
          on: boundary.input.instructions(),
          run: () => ({ action: 'allow' }),
        }),
      ],
    }).catch((error: unknown) => error)

    expect(speechError).toMatchObject({
      name: 'SafetyConfigError',
      boundaries: ['model.input.media'],
      scopes: ['call'],
    })
    expect(transcriptionError).toMatchObject({
      name: 'SafetyConfigError',
      boundaries: ['model.instructions'],
      scopes: ['call'],
    })
    expect(speechEvents).toEqual([])
    expect(transcriptionEvents).toEqual([])
  })

  it('runs an applicable global tuple member and audits its dormant member', async () => {
    const callback = vi.fn(() => ({ action: 'allow' as const }))
    setHooks({
      globalGuardrails: [
        guardrail({
          id: 'global-image-text-policy',
          on: [boundary.input.text(), boundary.output.text()] as const,
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
    expect(result.safety?.guardrails?.applied).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          guard: 'global-image-text-policy',
          boundary: 'model.output.text',
          action: 'dormant',
          reason: 'Global policy is dormant for generateImage at model.output.text.',
        }),
        expect.objectContaining({
          guard: 'global-image-text-policy',
          boundary: 'model.input.text',
          action: 'allow',
        }),
      ]),
    )
  })

  it('rejects duplicate ids before a global definition can become dormant', async () => {
    setHooks({
      globalGuardrails: [
        guardrail({
          id: 'duplicate-dormant-policy',
          on: boundary.output.text(),
          run: () => ({ action: 'allow' }),
        }),
      ],
    })
    const events: string[] = []
    const generateImage = bindCompletedOperation({
      definition: imageOperation(events),
      provider: 'test',
      operation: 'generateImage',
    })

    const error = await generateImage({
      model: fallback(['first-model', 'unused-model']),
      prompt: 'A quiet canal',
      guardrails: [
        guardrail({
          id: 'duplicate-dormant-policy',
          on: boundary.output.media(),
          run: () => ({ action: 'allow' }),
        }),
      ],
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      name: 'SafetyConfigError',
      duplicateId: 'duplicate-dormant-policy',
      scopes: ['global', 'call'],
    })
    expect(events).toEqual([])
  })

  it('validates media tuning before a global binding becomes dormant', async () => {
    setHooks({
      globalGuardrails: [
        guardrail({
          id: 'dormant-media-tune',
          on: boundary.input.media(),
          run: () => ({ action: 'allow' }),
        }),
      ],
    })
    const events: string[] = []
    const generateSpeech = bindCompletedOperation({
      definition: speechOperation(events),
      provider: 'test',
      operation: 'generateSpeech',
    })

    const error = await generateSpeech({
      model: 'speech-model',
      text: 'Read this.',
      safety: { tune: { 'dormant-media-tune': { stream: 'final' } } },
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ name: 'SafetyConfigError' })
    expect((error as Error).message).toContain('cannot set "stream"')
    expect(events).toEqual([])
  })
})
