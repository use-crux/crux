import { describe, expect, it } from 'vitest'
import * as nodeTranscription from '../src/transcription/node'
import type { SdkGateway } from '../src'
import { scriptedGateway } from './scripted-gateway'

describe('AI SDK Node transcription', () => {
  it('exposes only the default and injectable transcription operations', () => {
    expect(Object.keys(nodeTranscription).sort()).toEqual(['createAiSdkTranscribe', 'transcribe'])
  })

  it('injects URL materialization while preserving shared result mapping', async () => {
    const scripted = scriptedGateway({
      transcribe: [
        {
          text: 'Remote',
          segments: [{ text: 'Remote', startSecond: 0, endSecond: 1 }],
          warnings: [],
          responses: [],
          providerMetadata: {},
        },
      ],
    })

    const result = await nodeTranscription.createAiSdkTranscribe(scripted.gateway)({
      model: { provider: 'test', modelId: 'audio' } as never,
      audio: new URL('https://example.com/audio.wav'),
    })

    expect(scripted.calls.transcribe[0]?.download).toBeTypeOf('function')
    expect(result).toMatchObject({
      text: 'Remote',
      segments: [{ text: 'Remote', startSecond: 0, endSecond: 1 }],
      words: [],
      execution: { kind: 'native', calls: 1 },
    })
  })

  it('uses the secure downloader for Node URL materialization', async () => {
    const scripted = scriptedGateway()
    const gateway: SdkGateway = {
      ...scripted.gateway,
      async transcribe(args) {
        expect(args.audio).toEqual(new URL('https://example.com/audio.wav'))
        await args.download?.({
          url: new URL('https://127.0.0.1/audio.wav'),
          abortSignal: args.abortSignal,
        })
        throw new Error('download unexpectedly succeeded')
      },
    }

    await expect(
      nodeTranscription.createAiSdkTranscribe(gateway)({
        model: { provider: 'test', modelId: 'audio' } as never,
        audio: new URL('https://example.com/audio.wav'),
      }),
    ).rejects.toMatchObject({
      code: 'media_materialization_failed',
      reason: 'blocked-address',
    })
  })
})
