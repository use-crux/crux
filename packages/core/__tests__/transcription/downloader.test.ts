import { describe, expect, it, vi } from 'vitest'
import { createSecureAudioDownloader } from '../../src/transcription/node'

const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])

describe('secure audio downloader', () => {
  it('pins a validated public resolution and returns validated bytes', async () => {
    const fetch = vi.fn(async (_url, init) => ({
      status: 200,
      headers: new Headers({ 'content-type': 'audio/wav', 'content-length': String(wav.length) }),
      body: (async function* () { yield wav })(),
    }))
    const download = createSecureAudioDownloader({
      resolver: async () => ['93.184.216.34'],
      dispatcher: ({ address }) => ({ address }),
      fetch,
    })

    await expect(download(new URL('https://example.com/audio.wav'))).resolves.toMatchObject({ mediaType: 'audio/wav' })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[1].dispatcher).toEqual({ address: '93.184.216.34' })
  })

  it('rejects private resolutions and unsafe URLs before fetch', async () => {
    const fetch = vi.fn()
    const download = createSecureAudioDownloader({ resolver: async () => ['127.0.0.1'], fetch })
    await expect(download(new URL('https://secret.example/audio.wav?token=secret'))).rejects.toThrow(/public network address/)
    await expect(download(new URL('http://example.com/audio.wav'))).rejects.toThrow(/HTTPS/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('validates every redirect and strips caller credentials', async () => {
    const calls: Array<{ url: string; headers: Headers }> = []
    const fetch = vi.fn(async (url: URL, init) => {
      calls.push({ url: url.href, headers: new Headers(init.headers) })
      return calls.length === 1
        ? { status: 302, headers: new Headers({ location: 'https://cdn.example/audio.wav' }), body: null }
        : { status: 200, headers: new Headers({ 'content-type': 'audio/wav' }), body: (async function* () { yield wav })() }
    })
    const download = createSecureAudioDownloader({ resolver: async () => ['93.184.216.34'], fetch })
    await download(new URL('https://example.com/audio.wav'), { headers: { authorization: 'Bearer secret', cookie: 'x=1' } })
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer secret')
    expect(calls[1]?.headers.get('authorization')).toBeNull()
    expect(calls[1]?.headers.get('cookie')).toBeNull()
  })
})
