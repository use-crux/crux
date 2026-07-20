/** One-shot terminal constraints for completed transcription results. */

import { describe, expect, it, vi } from 'vitest'
import { bindCompletedOperation } from '../../src/adapter'
import { boundary, constraint, ConstraintViolationError, SafetyConfigError } from '../../src/safety'
import { inputAudio, transcriptionOperation } from './completed-operation-safety-transcription.fixture'

describe('completed operation Safety — transcription constraints', () => {
  it('returns a suggest failure with one-attempt audit and no provider retry', async () => {
    const events: string[] = []
    const requirement = constraint({
      id: 'transcript-soft-requirement',
      on: boundary.output.text(),
      severity: 'suggest',
      maxRetries: 8,
      run: vi.fn((text, context) => {
        expect(text).toBe('unsafe transcript')
        expect(context.attempt).toEqual({ index: 0, kind: 'initial' })
        return {
          pass: false as const,
          feedback: 'Use the preferred terminology.',
        }
      }),
    })
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation(events),
      provider: 'test',
      operation: 'transcribe',
    })

    const result = await transcribe({
      model: 'transcription-model',
      audio: inputAudio,
      constraints: [requirement],
    })

    expect(requirement.run).toHaveBeenCalledOnce()
    expect(events).toEqual(['normalize', 'invoke', 'validate', 'report'])
    expect(result.safety?.constraints).toMatchObject({
      allPassed: false,
      suggestFallback: true,
      entries: [
        {
          constraint: 'transcript-soft-requirement',
          severity: 'suggest',
          pass: false,
          attempts: 1,
          feedback: 'Use the preferred terminology.',
        },
      ],
    })
  })

  it('throws an assert failure after one attempt and zero provider retries', async () => {
    const events: string[] = []
    const requirement = constraint({
      id: 'transcript-hard-requirement',
      on: boundary.output.text(),
      maxRetries: 12,
      run: vi.fn(() => ({
        pass: false as const,
        feedback: 'Transcript does not meet the release requirement.',
      })),
    })
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation(events),
      provider: 'test',
      operation: 'transcribe',
    })

    const error = await transcribe({
      model: 'transcription-model',
      audio: inputAudio,
      constraints: [requirement],
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(ConstraintViolationError)
    if (!(error instanceof ConstraintViolationError)) throw error
    expect(error.totalAttempts).toBe(1)
    expect(error.audit.entries).toHaveLength(1)
    expect(error.audit.entries[0]).toMatchObject({
      constraint: 'transcript-hard-requirement',
      severity: 'assert',
      pass: false,
      attempts: 1,
    })
    expect(requirement.run).toHaveBeenCalledOnce()
    expect(events).toEqual(['normalize', 'invoke', 'validate'])
    expect(JSON.stringify(error)).not.toContain('unsafe transcript')
    expect(error.message).not.toContain('unsafe transcript')
  })

  it('checks report-mode assert constraints once without blocking the result', async () => {
    const requirement = constraint({
      id: 'report-transcript-requirement',
      on: boundary.output.text(),
      run: vi.fn(() => ({
        pass: false as const,
        feedback: 'Would fail enforcement.',
      })),
    })
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation([]),
      provider: 'test',
      operation: 'transcribe',
    })

    const result = await transcribe({
      model: 'transcription-model',
      audio: inputAudio,
      constraints: [requirement],
      safety: { tune: { 'report-transcript-requirement': { mode: 'report' } } },
    })

    expect(requirement.run).toHaveBeenCalledOnce()
    expect(result.text).toBe('unsafe transcript')
    expect(result.safety?.constraints).toMatchObject({
      allPassed: false,
      suggestFallback: false,
      entries: [
        {
          constraint: 'report-transcript-requirement',
          pass: false,
          attempts: 1,
        },
      ],
    })
  })

  it('rejects an unsafe-cast inapplicable local constraint before provider I/O', async () => {
    const events: string[] = []
    const objectRequirement = constraint({
      id: 'transcription-object-requirement',
      on: boundary.output.object<{ text: string }>(),
      run: () => ({ pass: true as const }),
    })
    const transcribe = bindCompletedOperation({
      definition: transcriptionOperation(events),
      provider: 'test',
      operation: 'transcribe',
    })

    const error = await transcribe({
      model: 'transcription-model',
      audio: inputAudio,
      constraints: [objectRequirement] as never,
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(SafetyConfigError)
    if (!(error instanceof SafetyConfigError)) throw error
    expect(error.boundaries).toEqual(['model.output.object'])
    expect(error.message).toContain('transcribe')
    expect(error.message).not.toContain(inputAudio.href)
    expect(events).toEqual([])
  })
})
