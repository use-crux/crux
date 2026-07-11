import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { GoogleGenAI } from '@google/genai'
import { transcriptionConformanceRow } from '@use-crux/core/adapter/testing'
import { createGoogle } from '../src'

const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])

describe('Google transcription', () => {
  it('uses one composed native call with audio and a fixed structured transcript route', async () => {
    const raw = response({
      text: 'Hello', language: 'en', segments: [{ text: 'Hello', start: 0, end: 1 }],
    })
    const generateContent = vi.fn(async (_args: unknown) => raw)
    const google = createGoogle(client(generateContent), { cachedContent: false })

    const result = await google.transcribe({ model: 'gemini-2.5-flash', audio: wav, extra: { temperature: 0 } })

    expect(transcriptionConformanceRow('google').support).toBe('composed')
    expect(generateContent).toHaveBeenCalledTimes(1)
    expect(generateContent.mock.calls[0]?.[0]).toMatchObject({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: expect.stringContaining('Transcribe only') }, { inlineData: { mimeType: 'audio/wav' } }] }],
      config: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: { required: ['text'] } },
    })
    expect(result.segments).toEqual([{ text: 'Hello', start: 0, end: 1 }])
    expect(result.warnings).toEqual([expect.stringContaining('composed')])
    expect(result.raw).toBe(raw)
    expectTypeOf(google.transcribe).toBeFunction()
  })

  it('keeps valid text but drops absent or invalid timing with warnings', async () => {
    const generateContent = vi.fn(async () => response({
      text: 'Hello', segments: [{ text: 'Hello', start: 2, end: 1 }],
    }))
    const result = await createGoogle(client(generateContent), { cachedContent: false }).transcribe({
      model: 'custom-audio-model', audio: wav,
    })
    expect(result.text).toBe('Hello')
    expect(result.segments).toEqual([])
    expect(result.warnings).toHaveLength(2)
  })

  it('rejects known unsupported models before I/O and preserves native errors', async () => {
    const generateContent = vi.fn(async () => response({ text: 'x' }))
    const google = createGoogle(client(generateContent), { cachedContent: false })
    await expect(google.transcribe({ model: 'imagen-4.0-generate-001', audio: wav })).rejects.toMatchObject({ code: 'unsupported_capability' })
    expect(generateContent).not.toHaveBeenCalled()

    const providerError = new Error('native failure')
    generateContent.mockRejectedValueOnce(providerError)
    await expect(google.transcribe({ model: 'custom-audio-model', audio: wav })).rejects.toBe(providerError)
  })
})

function client(generateContent: ReturnType<typeof vi.fn>): GoogleGenAI {
  return { models: { generateContent } } as never
}

function response(value: unknown) {
  return {
    text: JSON.stringify(value), responseId: 'resp_1', modelVersion: 'gemini-test',
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
  }
}
