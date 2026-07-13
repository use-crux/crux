import { describe, expect, it } from 'vitest'
import {
  createGenerateSpeechResult,
  createMediaMaterializationError,
  isMediaMaterializationError,
  validateGenerateImageOptions,
  validateGenerateSpeechOptions,
  validateTranscribeOptions,
  validateTranscriptionResult,
} from '../src'

describe('completed media contracts', () => {
  it('rejects invalid portable image combinations before provider I/O', () => {
    expect(() => validateGenerateImageOptions({ size: '1024x1024', aspectRatio: '1:1' })).toThrow(/either size or aspectRatio/)
    expect(() => validateGenerateImageOptions({ prompt: { text: 'edit', mask: dataAsset('image/png') } })).toThrow(/mask requires/)
    expect(() => validateGenerateImageOptions({ timeout: { totalMs: 0 } })).toThrow(/totalMs/)
  })

  it('validates transcription requests and honest ordered result detail', () => {
    expect(() => validateTranscribeOptions({ task: { type: 'translate', targetLanguage: ' ' } })).toThrow(/targetLanguage/)
    expect(() => validateTranscribeOptions({ timestamps: 'future' as never })).toThrow(/timestamps/)

    expect(validateTranscriptionResult({
      text: 'hello world',
      segments: [{ text: 'hello world', startSecond: 0, endSecond: 1 }],
      words: [
        { text: 'hello', startSecond: 0, endSecond: 0.4, speaker: 'a' },
        { text: 'world', startSecond: 0.5, endSecond: 1, speaker: 'a' },
      ],
      warnings: [],
      providerMetadata: { requestId: 'safe' },
      execution: { kind: 'native', calls: 1 },
    }, null)).toEqual({
      text: 'hello world',
      segments: [{ text: 'hello world', startSecond: 0, endSecond: 1 }],
      words: [
        { text: 'hello', startSecond: 0, endSecond: 0.4, speaker: 'a' },
        { text: 'world', startSecond: 0.5, endSecond: 1, speaker: 'a' },
      ],
      warnings: [],
      providerMetadata: { requestId: 'safe' },
      execution: { kind: 'native', calls: 1 },
      raw: null,
    })
  })

  it('rejects overlapping transcript intervals instead of repairing them', () => {
    expect(() => validateTranscriptionResult({
      text: 'hello world',
      segments: [],
      words: [
        { text: 'hello', startSecond: 0, endSecond: 0.7 },
        { text: 'world', startSecond: 0.6, endSecond: 1 },
      ],
      warnings: [],
      execution: { kind: 'native', calls: 1 },
    }, null)).toThrow(/ordered and non-overlapping/)
  })

  it('validates speech options and creates one usable byte-backed result', () => {
    expect(() => validateGenerateSpeechOptions({ text: ' ', speed: 1 })).toThrow(/text/)
    expect(() => validateGenerateSpeechOptions({ text: 'hello', speed: 0 })).toThrow(/speed/)

    const audio = dataAsset('audio/mpeg')
    const result = createGenerateSpeechResult(audio, {
      warnings: [],
      execution: { kind: 'native', calls: 1 },
      raw: { id: 'native' },
    })
    expect(result).toEqual({ audio, warnings: [], execution: { kind: 'native', calls: 1 }, raw: { id: 'native' } })
  })

  it('exposes only safe structural media-materialization failure fields', () => {
    const error = createMediaMaterializationError({ reason: 'blocked-address' })
    expect(isMediaMaterializationError(error)).toBe(true)
    expect(Object.keys(error).sort()).toEqual(['code', 'name', 'reason'])
    expect(JSON.stringify(error)).not.toContain('https://')
    expect(isMediaMaterializationError({ ...error, reason: 'unknown' })).toBe(false)
  })
})

function dataAsset(mediaType: string) {
  return { type: 'data' as const, data: new Uint8Array([1]), mediaType }
}
