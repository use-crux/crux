/** Completed transcription Safety over the canonical transcript result. */

import { describe, expect, it, vi } from 'vitest'
import type { TranscriptionResult } from '../../src'
import { bindCompletedOperation } from '../../src/adapter'
import { boundary, guardrail, GuardrailBlockedError } from '../../src/safety'
import { inputAudio, transcriptionOperation } from './completed-operation-safety-transcription.fixture'

describe('completed operation Safety — transcription output', () => {
  it('allows validated transcript text once before report and preserves result facts', async () => {
    const events: string[] = []
    let validated: TranscriptionResult | undefined
    const policy = guardrail({
      id: 'transcript-allow-policy',
      on: boundary.output.text(),
      run: vi.fn((text, context) => {
        events.push('guard:transcript')
        expect(text).toBe('unsafe transcript')
        expect(context.boundary.id).toBe('model.output.text')
        return { action: 'allow' as const }
      }),
    })
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation(events, {
        onValidate: (result) => {
          validated = result
        },
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
    expect(events).toEqual(['normalize', 'invoke', 'validate', 'guard:transcript', 'report'])
    expect(result.text).toBe('unsafe transcript')
    expect(result.segments).toBe(validated?.segments)
    expect(result.words).toBe(validated?.words)
    expect(result.raw).toBe(validated?.raw)
    expect(result.providerMetadata).toBe(validated?.providerMetadata)
    expect(result.safety?.guardrails?.applied[0]).toMatchObject({
      guard: 'transcript-allow-policy',
      boundary: 'model.output.text',
      phase: 'output',
      action: 'allow',
    })
  })

  it('records transcript warnings without changing canonical text', async () => {
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation([]),
      provider: 'test',
      operation: 'transcribe',
    })

    const result = await transcribe({
      model: 'transcription-model',
      audio: inputAudio,
      guardrails: [
        guardrail({
          id: 'transcript-warn-policy',
          on: boundary.output.text(),
          run: () => ({ action: 'warn', reason: 'Review transcript.' }),
        }),
      ],
    })

    expect(result.text).toBe('unsafe transcript')
    expect(result.safety?.guardrails?.applied[0]).toMatchObject({
      guard: 'transcript-warn-policy',
      action: 'warn',
      reason: 'Review transcript.',
    })
  })

  it('blocks transcript text after validation and before report', async () => {
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
          id: 'transcript-block-policy',
          on: boundary.output.text(),
          run: () => {
            events.push('guard:transcript')
            return { action: 'block', reason: 'Transcript is unsafe.' }
          },
        }),
      ],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(GuardrailBlockedError)
    expect(events).toEqual(['normalize', 'invoke', 'validate', 'guard:transcript'])
  })

  it('rewrites transcript authority, clears timed detail, and preserves all other facts', async () => {
    let validated: TranscriptionResult | undefined
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation([], {
        onValidate: (result) => {
          validated = result
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
          id: 'transcript-rewrite-policy',
          on: boundary.output.text(),
          run: () => ({
            action: 'rewrite',
            value: 'safe transcript',
            rewrite: { kind: 'mask' },
          }),
        }),
      ],
    })

    expect(result).not.toBe(validated)
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.text).toBe('safe transcript')
    expect(result.segments).toEqual([])
    expect(result.words).toEqual([])
    expect(Object.isFrozen(result.segments)).toBe(true)
    expect(Object.isFrozen(result.words)).toBe(true)
    expect(result.language).toBe(validated?.language)
    expect(result.durationInSeconds).toBe(validated?.durationInSeconds)
    expect(result.warnings).toEqual(validated?.warnings)
    expect(result.warnings[0]).toBe(validated?.warnings[0])
    expect(result.providerMetadata).toBe(validated?.providerMetadata)
    expect(result.execution).toEqual(validated?.execution)
    expect(result.raw).toBe(validated?.raw)
    expect(result.safety?.guardrails?.applied[0]).toMatchObject({
      guard: 'transcript-rewrite-policy',
      action: 'mask',
      timedTranscriptDetailRemoved: true,
    })
  })

  it('records report-mode rewrite intent without clearing transcript detail', async () => {
    let validated: TranscriptionResult | undefined
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation([], {
        onValidate: (result) => {
          validated = result
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
          id: 'report-transcript-rewrite-policy',
          mode: 'report',
          on: boundary.output.text(),
          run: () => ({
            action: 'rewrite',
            value: 'safe transcript',
            rewrite: { kind: 'redact' },
          }),
        }),
      ],
    })

    expect(result.text).toBe('unsafe transcript')
    expect(result.segments).toBe(validated?.segments)
    expect(result.words).toBe(validated?.words)
    expect(result.safety?.guardrails?.applied[0]).toMatchObject({
      guard: 'report-transcript-rewrite-policy',
      mode: 'report',
      action: 'redact',
    })
  })
})
