/** Completed transcription Safety over canonical input audio and transcript text. */

import { describe, expect, it, vi } from 'vitest'
import { bindCompletedOperation } from '../../src/adapter'
import { boundary, guardrail, GuardrailBlockedError } from '../../src/safety'
import { inputAudio, transcriptionOperation } from './completed-operation-safety-transcription.fixture'

describe('completed operation Safety — transcription input', () => {
  it('allows required audio before normalization and preserves source identity', async () => {
    const events: string[] = []
    const policy = guardrail({
      id: 'transcription-audio-allow-policy',
      on: boundary.input.media(),
      run: vi.fn((subject) => {
        events.push('guard:audio')
        expect(subject.part.source).toBe(inputAudio)
        return { action: 'allow' as const }
      }),
    })
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation(events, {
        onNormalize: (input) => expect(input.audio).toBe(inputAudio),
      }),
      provider: 'test',
      operation: 'transcribe',
    })

    const result = await transcribe({
      model: 'transcription-model',
      audio: inputAudio,
      guardrails: [policy],
    })

    expect(policy.run).toHaveBeenCalledOnce()
    expect(events.slice(0, 2)).toEqual(['guard:audio', 'normalize'])
    expect(result.safety?.guardrails?.applied[0]).toMatchObject({
      guard: 'transcription-audio-allow-policy',
      boundary: 'user.input.media',
      phase: 'input',
      action: 'allow',
    })
  })

  it('blocks required audio before normalization or provider I/O', async () => {
    const events: string[] = []
    const policy = guardrail({
      id: 'transcription-audio-policy',
      on: boundary.input.media(),
      run: vi.fn((subject) => {
        events.push('guard:audio')
        expect(subject.part.source).toBe(inputAudio)
        expect(subject.origin).toEqual({
          kind: 'operation',
          operation: 'transcribe',
          phase: 'input',
          field: 'audio',
          partIndex: 0,
        })
        return { action: 'block' as const, reason: 'Audio is not permitted.' }
      }),
    })
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation(events),
      provider: 'test',
      operation: 'transcribe',
    })

    const error = await transcribe({
      model: 'transcription-model',
      audio: inputAudio,
      guardrails: [policy],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect(policy.run).toHaveBeenCalledOnce()
    expect(events).toEqual(['guard:audio'])
  })

  it('escalates enforced strip of required audio before normalization', async () => {
    const events: string[] = []
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation(events),
      provider: 'test',
      operation: 'transcribe',
    })

    const error = await transcribe({
      model: 'transcription-model',
      audio: inputAudio,
      guardrails: [
        guardrail({
          id: 'required-transcription-audio-policy',
          on: boundary.input.media(),
          run: () => {
            events.push('guard:audio')
            return { action: 'strip', reason: 'Audio must be removed.' }
          },
        }),
      ],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    if (!(error instanceof GuardrailBlockedError)) throw error
    expect(error.guardrailId).toBe('required-transcription-audio-policy')
    expect(error.phase).toBe('input')
    expect(error.decisions[0]).toMatchObject({
      action: 'block',
      location: {
        origin: {
          kind: 'operation',
          operation: 'transcribe',
          phase: 'input',
          field: 'audio',
          partIndex: 0,
        },
        partType: 'audio',
      },
    })
    expect(events).toEqual(['guard:audio'])
  })

  it('preserves required audio for report-mode strip before normalization', async () => {
    let normalizedAudio: unknown
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation([], {
        onNormalize: (input) => {
          normalizedAudio = input.audio
        },
      }),
      provider: 'test',
      operation: 'transcribe',
    })

    const result = await transcribe({
      model: 'transcription-model',
      audio: inputAudio,
      guardrails: [
        guardrail({
          id: 'report-transcription-audio-policy',
          mode: 'report',
          on: boundary.input.media(),
          run: () => ({ action: 'strip', reason: 'Would remove audio.' }),
        }),
      ],
    })

    expect(normalizedAudio).toBe(inputAudio)
    expect(result.safety?.guardrails?.applied[0]).toMatchObject({
      guard: 'report-transcription-audio-policy',
      mode: 'report',
      action: 'strip',
      reason: 'Would remove audio.',
    })
    expect(result.safety?.guardrails?.applied[0]).not.toHaveProperty('escalatedToBlock')
  })

  it('rewrites the prompt hint only through user input before normalization', async () => {
    const events: string[] = []
    let normalizedPrompt: string | undefined
    const userPolicy = guardrail({
      id: 'transcription-prompt-policy',
      on: boundary.input.user(),
      run: vi.fn((text, context) => {
        events.push('guard:user')
        expect(text).toBe('Names include a private person')
        expect(context.boundary.id).toBe('user.input')
        return {
          action: 'rewrite' as const,
          value: 'Names are redacted',
          rewrite: { kind: 'redact' as const },
        }
      }),
    })
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation(events, {
        onNormalize: (input) => {
          normalizedPrompt = input.prompt
        },
      }),
      provider: 'test',
      operation: 'transcribe',
    })

    await transcribe({
      model: 'transcription-model',
      audio: inputAudio,
      prompt: 'Names include a private person',
      guardrails: [userPolicy],
    })

    expect(userPolicy.run).toHaveBeenCalledOnce()
    expect(events.slice(0, 2)).toEqual(['guard:user', 'normalize'])
    expect(normalizedPrompt).toBe('Names are redacted')
  })
})
