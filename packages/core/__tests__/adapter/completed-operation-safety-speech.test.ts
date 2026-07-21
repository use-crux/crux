/** Completed speech Safety over canonical inputs and required output audio. */

import { describe, expect, it, vi } from 'vitest'
import type { GenerateSpeechOptions } from '../../src'
import { bindCompletedOperation } from '../../src/adapter'
import { boundary, guardrail, GuardrailBlockedError } from '../../src/safety'
import { generatedAudio, speechOperation } from './completed-operation-safety-speech.fixture'

describe('completed operation Safety — speech', () => {
  it('allows generated audio with exact source identity and output origin', async () => {
    const events: string[] = []
    const policy = guardrail({
      id: 'generated-speech-allow-policy',
      on: boundary.output.media(),
      run: vi.fn((subject) => {
        events.push('guard')
        expect(subject.part.source).toBe(generatedAudio)
        expect(subject.origin).toEqual({
          kind: 'operation',
          operation: 'generateSpeech',
          phase: 'output',
          field: 'audio',
          partIndex: 0,
        })
        return { action: 'allow' as const }
      }),
    })
    const generateSpeech = bindCompletedOperation({
      definition: speechOperation(events),
      provider: 'test',
      operation: 'generateSpeech',
    })

    const result = await generateSpeech({
      model: 'speech-model',
      text: 'Welcome aboard',
      guardrails: [policy],
    })

    expect(policy.run).toHaveBeenCalledOnce()
    expect(events).toEqual(['normalize', 'invoke', 'validate', 'guard', 'report'])
    expect(result.audio).toBe(generatedAudio)
    expect(result.safety?.guardrails?.applied).toHaveLength(1)
    expect(result.safety?.guardrails?.applied[0]).toMatchObject({
      guard: 'generated-speech-allow-policy',
      boundary: 'model.output.media',
      phase: 'output',
      action: 'allow',
    })
  })

  it('warns without changing required generated audio', async () => {
    const events: string[] = []
    const generateSpeech = bindCompletedOperation({
      definition: speechOperation(events),
      provider: 'test',
      operation: 'generateSpeech',
    })

    const result = await generateSpeech({
      model: 'speech-model',
      text: 'Welcome aboard',
      guardrails: [
        guardrail({
          id: 'generated-speech-warn-policy',
          on: boundary.output.media(),
          run: () => ({ action: 'warn', reason: 'Review generated audio.' }),
        }),
      ],
    })

    expect(result.audio).toBe(generatedAudio)
    expect(result.safety?.guardrails?.blocked).toBe(false)
    expect(result.safety?.guardrails?.applied[0]).toMatchObject({
      guard: 'generated-speech-warn-policy',
      action: 'warn',
      reason: 'Review generated audio.',
    })
  })

  it('escalates enforced strip of required audio before reporting', async () => {
    const events: string[] = []
    const generateSpeech = bindCompletedOperation({
      definition: speechOperation(events),
      provider: 'test',
      operation: 'generateSpeech',
    })

    const error = await generateSpeech({
      model: 'speech-model',
      text: 'Welcome aboard',
      guardrails: [
        guardrail({
          id: 'required-speech-audio-policy',
          on: boundary.output.media(),
          run: () => {
            events.push('guard')
            return { action: 'strip', reason: 'Generated audio is unsafe.' }
          },
        }),
      ],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    if (!(error instanceof GuardrailBlockedError)) throw error
    expect(error.guardrailId).toBe('required-speech-audio-policy')
    expect(error.phase).toBe('output')
    expect(error.decisions[0]).toMatchObject({
      policyId: 'required-speech-audio-policy',
      action: 'block',
      reason: 'Generated audio is unsafe.',
      location: {
        origin: {
          kind: 'operation',
          operation: 'generateSpeech',
          phase: 'output',
          field: 'audio',
          partIndex: 0,
        },
        partType: 'audio',
      },
    })
    expect(events).toEqual(['normalize', 'invoke', 'validate', 'guard'])
  })

  it('preserves required audio for report-mode strip', async () => {
    const generateSpeech = bindCompletedOperation({
      definition: speechOperation([]),
      provider: 'test',
      operation: 'generateSpeech',
    })

    const result = await generateSpeech({
      model: 'speech-model',
      text: 'Welcome aboard',
      guardrails: [
        guardrail({
          id: 'report-speech-audio-policy',
          mode: 'report',
          on: boundary.output.media(),
          run: () => ({ action: 'strip', reason: 'Would remove generated audio.' }),
        }),
      ],
    })

    expect(result.audio).toBe(generatedAudio)
    expect(result.safety?.guardrails?.blocked).toBe(false)
    expect(result.safety?.guardrails?.applied[0]).toMatchObject({
      guard: 'report-speech-audio-policy',
      mode: 'report',
      action: 'strip',
      reason: 'Would remove generated audio.',
    })
    expect(result.safety?.guardrails?.applied[0]).not.toHaveProperty('escalatedToBlock')
  })

  it('rewrites speech text through user input before normalization', async () => {
    const events: string[] = []
    let normalized: GenerateSpeechOptions<string> | undefined
    const generateSpeech = bindCompletedOperation({
      definition: speechOperation(events, {
        onNormalize: (input) => {
          normalized = input
        },
      }),
      provider: 'test',
      operation: 'generateSpeech',
    })

    const policy = guardrail({
      id: 'speech-user-input-policy',
      on: boundary.input.text(),
      run: vi.fn((text, context) => {
        events.push('guard:user')
        expect(text).toBe('Read secret aloud')
        expect(context.boundary.id).toBe('model.input.text')
        expect(context.origin).toEqual({ source: 'user', kind: 'operation' })
        return {
          action: 'rewrite',
          value: 'Read [REDACTED] aloud',
          rewrite: { kind: 'redact' },
        }
      }),
    })

    const result = await generateSpeech({
      model: 'speech-model',
      text: 'Read secret aloud',
      instructions: 'Speak slowly',
      guardrails: [policy],
    })

    expect(policy.run).toHaveBeenCalledOnce()
    expect(events.slice(0, 2)).toEqual(['guard:user', 'normalize'])
    expect(normalized?.text).toBe('Read [REDACTED] aloud')
    expect(normalized?.instructions).toBe('Speak slowly')
    expect(result.safety?.guardrails?.applied[0]).toMatchObject({
      guard: 'speech-user-input-policy',
      boundary: 'model.input.text',
      phase: 'input',
      action: 'redact',
    })
  })

  it('rewrites speech instructions through model input before normalization', async () => {
    const events: string[] = []
    let normalized: GenerateSpeechOptions<string> | undefined
    const generateSpeech = bindCompletedOperation({
      definition: speechOperation(events, {
        onNormalize: (input) => {
          normalized = input
        },
      }),
      provider: 'test',
      operation: 'generateSpeech',
    })

    const policy = guardrail({
      id: 'speech-model-input-policy',
      on: boundary.input.instructions(),
      run: vi.fn((instructions, context) => {
        events.push('guard:model')
        expect(instructions).toBe('Imitate a secret voice')
        expect(context.boundary.id).toBe('model.instructions')
        return {
          action: 'rewrite',
          value: 'Use a neutral voice',
          rewrite: { kind: 'normalize' },
        }
      }),
    })

    await generateSpeech({
      model: 'speech-model',
      text: 'Welcome aboard',
      instructions: 'Imitate a secret voice',
      guardrails: [policy],
    })

    expect(policy.run).toHaveBeenCalledOnce()
    expect(events.slice(0, 2)).toEqual(['guard:model', 'normalize'])
    expect(normalized?.text).toBe('Welcome aboard')
    expect(normalized?.instructions).toBe('Use a neutral voice')
  })
})
