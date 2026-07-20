/** Transcript-detail audit and serialization privacy after Safety rewrites. */

import { afterEach, describe, expect, it } from 'vitest'
import type { TranscriptionResult } from '../../src'
import { bindCompletedOperation, defineCompletedOperation } from '../../src/adapter'
import { safetyDecisionToTurnDecision } from '../../src/observability/turn-decision-report'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { boundary, guardrail } from '../../src/safety'
import { transcriptionOperation, inputAudio } from '../adapter/completed-operation-safety-transcription.fixture'

describe('transcript Safety privacy', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('audits timed-detail loss without serializing original or rewritten transcript text', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
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
          id: 'rewrite-private-transcript',
          on: boundary.output.text(),
          run: () => ({
            action: 'rewrite',
            value: 'SAFE_REWRITTEN_TRANSCRIPT_SENTINEL',
            rewrite: { kind: 'redact' },
          }),
        }),
      ],
    })
    await observe.flush()

    expect(result.segments).toEqual([])
    expect(result.words).toEqual([])
    expect(result.safety?.guardrails?.applied[0]).toMatchObject({
      guard: 'rewrite-private-transcript',
      timedTranscriptDetailRemoved: true,
    })
    const serialized = JSON.stringify({
      audit: result.safety,
      observations: transport.records,
    })
    expect(serialized).not.toContain('unsafe transcript')
    expect(serialized).not.toContain('SAFE_REWRITTEN_TRANSCRIPT_SENTINEL')
  })

  it('preserves raw result identities while every evidence projection omits transcript duplicates', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    const transcribe = bindCompletedOperation({
      definition: privateTranscriptionOperation(),
      provider: 'test',
      operation: 'transcribe',
    })

    const result = await transcribe({
      model: 'transcription-model',
      audio: new URL('https://example.com/SECRET_AUDIO_LOCATOR.wav'),
      guardrails: [
        guardrail({
          id: 'allow-private-transcript',
          on: boundary.output.text(),
          run: () => ({ action: 'allow' }),
        }),
      ],
    })
    await observe.flush()

    expect(result.text).toBe('SECRET_CANONICAL_TRANSCRIPT')
    expect(result.segments[0]?.text).toBe('SECRET_SEGMENT_TRANSCRIPT')
    expect(result.words[0]?.text).toBe('SECRET_WORD_TRANSCRIPT')
    expect(result.warnings[0]).toMatchObject({
      message: 'SECRET_WARNING_TRANSCRIPT',
    })
    expect(result.providerMetadata).toMatchObject({
      duplicate: 'SECRET_PROVIDER_TRANSCRIPT',
    })
    expect(result.raw).toMatchObject({ duplicate: 'SECRET_RAW_TRANSCRIPT' })

    const report = safetyDecisionToTurnDecision({
      policyId: 'allow-private-transcript',
      kind: 'guardrail',
      boundary: 'model.output.text',
      mode: 'enforce',
      action: 'allow',
      durationMs: 1,
      captured: {
        level: 'safe',
        sizeBytes: 27,
        hash: 'safe-hash',
        preview: 'SECRET_CANONICAL_TRANSCRIPT',
      },
    })
    const serialized = JSON.stringify({
      audit: result.safety,
      observations: transport.records,
      report,
    })
    for (const sentinel of [
      'SECRET_AUDIO_LOCATOR',
      'SECRET_CANONICAL_TRANSCRIPT',
      'SECRET_SEGMENT_TRANSCRIPT',
      'SECRET_WORD_TRANSCRIPT',
      'SECRET_WARNING_TRANSCRIPT',
      'SECRET_PROVIDER_TRANSCRIPT',
      'SECRET_RAW_TRANSCRIPT',
    ]) {
      expect(serialized).not.toContain(sentinel)
    }
  })
})

function privateTranscriptionOperation() {
  return defineCompletedOperation({
    normalize: (input: Readonly<{ model: string; audio: URL }>) => input,
    support: () => 'supported' as const,
    async invoke(_input, context) {
      return context.call('audio.transcribe', async () => Object.freeze({ duplicate: 'SECRET_RAW_TRANSCRIPT' }))
    },
    validate(raw): TranscriptionResult {
      return Object.freeze({
        text: 'SECRET_CANONICAL_TRANSCRIPT',
        segments: Object.freeze([
          Object.freeze({
            text: 'SECRET_SEGMENT_TRANSCRIPT',
            startSecond: 0,
            endSecond: 1,
          }),
        ]),
        words: Object.freeze([
          Object.freeze({
            text: 'SECRET_WORD_TRANSCRIPT',
            startSecond: 0,
            endSecond: 1,
          }),
        ]),
        warnings: Object.freeze([{ message: 'SECRET_WARNING_TRANSCRIPT' }]),
        providerMetadata: Object.freeze({
          duplicate: 'SECRET_PROVIDER_TRANSCRIPT',
        }),
        execution: Object.freeze({ kind: 'native' as const, calls: 1 }),
        raw,
      })
    },
    report: () => ({ kind: 'audio' as const, segments: 1, words: 1 }),
    conformance: [],
  })
}
