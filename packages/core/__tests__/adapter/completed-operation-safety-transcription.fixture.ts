/** Shared completed-transcription fixtures for Safety integration tests. */

import type { TranscribeOptions, TranscriptionResult } from '../../src'
import { defineCompletedOperation } from '../../src/adapter'

export const inputAudio = new URL('https://example.com/private-audio.wav')

export const transcriptSegments = Object.freeze([
  Object.freeze({ text: 'unsafe transcript', startSecond: 0, endSecond: 1 }),
])

export const transcriptWords = Object.freeze([
  Object.freeze({ text: 'unsafe', startSecond: 0, endSecond: 0.5 }),
  Object.freeze({ text: 'transcript', startSecond: 0.5, endSecond: 1 }),
])

/** Define a deterministic transcription operation with observable lifecycle seams. */
export function transcriptionOperation(
  events: string[],
  options: Readonly<{
    onNormalize?: (input: TranscribeOptions<string>) => void
    onValidate?: (result: TranscriptionResult) => void
  }> = {},
) {
  return defineCompletedOperation({
    normalize(input: TranscribeOptions<string>) {
      events.push('normalize')
      options.onNormalize?.(input)
      return input
    },
    support: () => 'supported' as const,
    invoke: async (_input, context) =>
      context.call('audio.transcribe', async () => {
        events.push('invoke')
        return Object.freeze({ requestId: 'transcription-1' })
      }),
    validate(raw) {
      events.push('validate')
      const result: TranscriptionResult = Object.freeze({
        text: 'unsafe transcript',
        segments: transcriptSegments,
        words: transcriptWords,
        language: 'en',
        durationInSeconds: 1,
        warnings: Object.freeze([{ code: 'sample-warning' }]),
        providerMetadata: Object.freeze({ requestId: raw.requestId }),
        execution: Object.freeze({ kind: 'native' as const, calls: 1 }),
        raw,
      })
      options.onValidate?.(result)
      return result
    },
    report: () => {
      events.push('report')
      return { kind: 'audio' as const }
    },
    conformance: [],
  })
}
