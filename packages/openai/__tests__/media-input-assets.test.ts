import { describe, expect, it, vi } from 'vitest'
import { prompt, type StoredAsset } from '@use-crux/core'
import { createOpenAI } from '../src'
import { client, completion } from './media-input.fixtures'

const mediaPrompt = prompt({ id: 'openai-media-assets', prompt: 'Inspect the supplied media.' })

describe('OpenAI usable asset lowering', () => {
  it('accepts Blob-backed data and stored assets directly', async () => {
    const directBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const storedBlob = new Blob([new Uint8Array([4, 5, 6])], { type: 'application/pdf' })
    const directRead = vi.spyOn(directBlob, 'arrayBuffer')
    const storedRead = vi.spyOn(storedBlob, 'arrayBuffer')
    const create = vi.fn(async (_request: unknown) => completion('done'))
    const stored: StoredAsset = {
      type: 'data',
      data: storedBlob,
      mediaType: 'application/pdf',
      filename: 'stored.pdf',
      ref: { uri: 'memory://private/stored-file' },
    }

    await createOpenAI(client({ create })).generate(mediaPrompt, {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'data', data: directBlob, mediaType: 'image/png' } },
            { type: 'file', source: stored },
          ],
        },
      ],
    })

    expect(directRead).toHaveBeenCalledOnce()
    expect(storedRead).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]![0]).toMatchObject({
      messages: [
        {
          content: [
            { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
            {
              type: 'file',
              file: { file_data: 'data:application/pdf;base64,BAUG', filename: 'stored.pdf' },
            },
          ],
        },
      ],
    })
    expect(JSON.stringify(create.mock.calls[0]![0])).not.toContain('memory://private/stored-file')
  })

  it('keeps provider-file audio IDs in the native file-id field', async () => {
    const create = vi.fn(async (_request: unknown) => completion('done'))

    await createOpenAI(client({ create })).generate(mediaPrompt, {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              source: {
                type: 'provider-file',
                provider: 'openai',
                fileId: 'file-audio-private',
                mediaType: 'audio/mpeg',
              },
            },
          ],
        },
      ],
    })

    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]![0]).toMatchObject({
      messages: [{ content: [{ type: 'file', file: { file_id: 'file-audio-private' } }] }],
    })
    expect(create.mock.calls[0]![0]).not.toMatchObject({
      messages: [{ content: [{ type: 'input_audio' }] }],
    })
  })
})
