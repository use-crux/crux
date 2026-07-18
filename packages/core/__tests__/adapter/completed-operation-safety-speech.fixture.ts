/** Shared completed-speech operation fixtures for Safety integration tests. */

import { createGenerateSpeechResult, type GenerateSpeechOptions, type GenerateSpeechResult } from '../../src'
import { defineCompletedOperation } from '../../src/adapter'

export const generatedAudio = Object.freeze({
  type: 'data' as const,
  data: new Uint8Array([1, 2, 3]),
  mediaType: 'audio/mpeg',
})

/** Define a deterministic speech operation with observable lifecycle seams. */
export function speechOperation(
  events: string[],
  options: Readonly<{
    onNormalize?: (input: GenerateSpeechOptions<string>) => void
    onValidate?: (result: GenerateSpeechResult) => void
  }> = {},
) {
  return defineCompletedOperation({
    normalize(input: GenerateSpeechOptions<string>) {
      events.push('normalize')
      options.onNormalize?.(input)
      return input
    },
    support: () => 'supported' as const,
    invoke: async (_input, context) =>
      context.call('audio.speech', async () => {
        events.push('invoke')
        return Object.freeze({ requestId: 'speech-1' })
      }),
    validate(raw) {
      events.push('validate')
      const result = createGenerateSpeechResult(generatedAudio, {
        warnings: Object.freeze([{ code: 'sample-warning' }]),
        providerMetadata: Object.freeze({ requestId: raw.requestId }),
        execution: { kind: 'native', calls: 1 },
        raw,
      })
      options.onValidate?.(result)
      return result
    },
    report: () => {
      events.push('report')
      return { kind: 'audio' }
    },
    conformance: [],
  })
}
