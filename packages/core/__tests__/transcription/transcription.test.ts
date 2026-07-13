import { describe, expect, it } from 'vitest'
import {
  isNoTranscriptError,
  normalizeAudioSource,
  validateTranscriptionResult,
} from '../../src/transcription'

describe('core transcription', () => {
  it('preserves provider-native assets and copies byte sources', async () => {
    const providerFile = { type: 'provider-file' as const, provider: 'openai', fileId: 'file_1', mediaType: 'audio/mpeg' }
    await expect(normalizeAudioSource(providerFile)).resolves.toBe(providerFile)

    const input = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])
    const normalized = await normalizeAudioSource(input, { mediaType: 'audio/wav' })
    input[0] = 0
    expect(normalized).toMatchObject({ type: 'data', mediaType: 'audio/wav' })
    expect((normalized as { data: Uint8Array }).data[0]).toBe(0x52)
  })

  it('validates ordered seconds segments and maps semantic emptiness to a tagged error', () => {
    expect(validateTranscriptionResult({
      text: 'hello',
      segments: [{ text: 'hello', startSecond: 0, endSecond: 1.25 }],
      warnings: [],
      execution: { kind: 'native', calls: 1 },
    }, null)).toEqual({
      text: 'hello',
      segments: [{ text: 'hello', startSecond: 0, endSecond: 1.25 }],
      words: [],
      warnings: [],
      execution: { kind: 'native', calls: 1 },
      raw: null,
    })
    try {
      validateTranscriptionResult({
        text: '   ',
        segments: [],
        warnings: [],
        execution: { kind: 'native', calls: 1 },
      }, { provider: 'empty' })
      throw new Error('expected failure')
    } catch (error) {
      expect(isNoTranscriptError(error)).toBe(true)
      expect((error as Error & { cause?: unknown }).cause).toEqual({ provider: 'empty' })
    }
  })
})
