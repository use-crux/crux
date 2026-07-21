import { describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import { EmbeddingModalityError } from '@use-crux/core/embedding'
import { embedding } from '../src/embedding'

describe('OpenAI embedding modalities', () => {
  it('rejects image input before calling the text-only OpenAI API', async () => {
    const create = vi.fn()
    const client = { embeddings: { create } } as unknown as OpenAI
    const model = embedding(client, {
      name: 'openai-text',
      model: 'text-embedding-3-small',
    })

    await expect(model.embed({
      type: 'image',
      source: { type: 'data', data: new Uint8Array([1]), mediaType: 'image/png' },
    } as never)).rejects.toBeInstanceOf(EmbeddingModalityError)
    expect(create).not.toHaveBeenCalled()
  })
})
