import { describe, expect, it } from 'vitest'
import { createCruxAi, transcribe } from '../src'
import { transcriptionConformanceRow } from '@use-crux/core/adapter/testing'
import { scriptedGateway } from './scripted-gateway'

const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])

describe('AI SDK transcription', () => {
  it('performs exactly one native gateway operation and preserves native result facts', async () => {
    expect(transcriptionConformanceRow('ai-sdk').support).toBe('native')
    const scripted = scriptedGateway({ transcribe: [{
      text: 'Hello',
      segments: [{ text: 'Hello', startSecond: 0, endSecond: 1 }],
      language: 'en',
      durationInSeconds: 1,
      warnings: [{ type: 'other', message: 'native warning' }],
      responses: [{ timestamp: new Date(0), modelId: 'audio-model' }],
      providerMetadata: { provider: { requestId: 'req_1' } },
    }] })
    const ai = createCruxAi({ gateway: scripted.gateway })

    const result = await ai.transcribe({
      model: { provider: 'test', modelId: 'audio-model' } as never,
      audio: wav,
      extra: { maxRetries: 0, headers: { 'x-test': '1' } },
    })

    expect(scripted.calls.transcribe).toHaveLength(1)
    expect(scripted.calls.generateText).toHaveLength(0)
    expect(scripted.calls.generateObject).toHaveLength(0)
    expect(scripted.calls.generateImage).toHaveLength(0)
    expect(scripted.calls.streamText).toHaveLength(0)
    expect(scripted.calls.transcribe[0]).toMatchObject({ audio: wav, maxRetries: 0, headers: { 'x-test': '1' } })
    expect(result).toMatchObject({
      text: 'Hello', segments: [{ text: 'Hello', start: 0, end: 1 }], language: 'en', durationInSeconds: 1,
      metadata: { providerMetadata: { provider: { requestId: 'req_1' } } },
    })
    expect(result.raw.text).toBe('Hello')
    expect(typeof transcribe).toBe('function')
  })

  it('rejects unproven common language mapping before gateway I/O', async () => {
    const scripted = scriptedGateway()
    await expect(createCruxAi({ gateway: scripted.gateway }).transcribe({
      model: { provider: 'custom', modelId: 'audio' } as never,
      audio: wav,
      language: 'en',
    })).rejects.toMatchObject({ code: 'unsupported_capability' })
    expect(scripted.calls.transcribe).toHaveLength(0)
  })

  it('always supplies the Crux-bounded downloader for URL audio', async () => {
    const scripted = scriptedGateway({ transcribe: [{
      text: 'Remote', segments: [], warnings: [], responses: [], providerMetadata: {},
    }] })
    await createCruxAi({ gateway: scripted.gateway }).transcribe({
      model: { provider: 'test', modelId: 'audio' } as never,
      audio: new URL('https://example.com/audio.wav'),
    })
    expect(scripted.calls.transcribe[0]).toMatchObject({ audio: new URL('https://example.com/audio.wav') })
    expect(scripted.calls.transcribe[0]?.download).toBeTypeOf('function')
  })

  it('preserves native gateway failures unchanged', async () => {
    const failure = new Error('native failure')
    const scripted = scriptedGateway({ transcribe: [failure] })
    await expect(createCruxAi({ gateway: scripted.gateway }).transcribe({
      model: { provider: 'test', modelId: 'audio' } as never,
      audio: wav,
    })).rejects.toBe(failure)
  })
})
