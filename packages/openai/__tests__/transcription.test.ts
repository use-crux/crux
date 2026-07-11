import { describe, expect, it, vi } from 'vitest'
import { isNoTranscriptError } from '@use-crux/core'
import { transcriptionConformanceRow } from '@use-crux/core/adapter/testing'
import { createOpenAI } from '../src'

const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])

describe('OpenAI transcription', () => {
  it('performs exactly one native call and normalizes ordered seconds segments', async () => {
    expect(transcriptionConformanceRow('openai').support).toBe('native')
    const create = vi.fn(async (_body: unknown, _options?: unknown) => ({
      text: 'Hello world',
      language: 'en',
      duration: 1.5,
      segments: [{ id: 0, text: 'Hello world', start: 0, end: 1.5 }],
      usage: { type: 'duration', seconds: 1.5 },
    }))
    const adapter = createOpenAI(client(create))

    const result = await adapter.transcribe({
      model: 'whisper-1',
      audio: wav,
      language: 'en',
      prompt: 'Product names: Crux',
      extra: { temperature: 0 },
    })

    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      model: 'whisper-1', language: 'en', prompt: 'Product names: Crux',
      response_format: 'verbose_json', temperature: 0,
    })
    expect(result).toMatchObject({
      text: 'Hello world', language: 'en', durationInSeconds: 1.5,
      segments: [{ text: 'Hello world', start: 0, end: 1.5 }],
      metadata: { usage: { type: 'duration', seconds: 1.5 } },
    })
    expect(JSON.stringify(result)).not.toMatch(/capture|error/i)
    expect(adapter).not.toHaveProperty('experimental')
    expect(adapter).not.toHaveProperty('store')
  })

  it('preserves native API and abort failures unchanged', async () => {
    const providerError = Object.assign(new Error('request aborted'), { name: 'AbortError' })
    const create = vi.fn(async (_body: unknown, _options?: unknown) => Promise.reject(providerError))
    await expect(createOpenAI(client(create)).transcribe({ model: 'whisper-1', audio: wav })).rejects.toBe(providerError)
  })

  it('returns an empty segment array with a warning when native timing is absent', async () => {
    const create = vi.fn(async (_body: unknown, _options?: unknown) => ({ text: 'Hello' }))
    const result = await createOpenAI(client(create)).transcribe({ model: 'gpt-4o-transcribe', audio: wav })
    expect(result.segments).toEqual([])
    expect(result.warnings).toEqual([expect.stringContaining('segments')])
  })

  it('rejects unsupported provider files before I/O and tags semantic emptiness', async () => {
    const create = vi.fn(async (_body: unknown, _options?: unknown) => ({ text: '  ' }))
    const adapter = createOpenAI(client(create))
    await expect(adapter.transcribe({
      model: 'whisper-1',
      audio: { type: 'provider-file', provider: 'openai', fileId: 'file_1', mediaType: 'audio/mpeg' },
    })).rejects.toMatchObject({ code: 'unsupported_capability' })
    expect(create).not.toHaveBeenCalled()

    try {
      await adapter.transcribe({ model: 'whisper-1', audio: wav })
      throw new Error('expected failure')
    } catch (error) {
      expect(isNoTranscriptError(error)).toBe(true)
    }
  })
})

function client(create: ReturnType<typeof vi.fn>) {
  const value = { audio: { transcriptions: { create } } }
  Object.defineProperty(value, 'storage', { get: () => { throw new Error('storage must not be read') } })
  return value as never
}
