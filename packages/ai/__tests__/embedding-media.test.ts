import { describe, expect, it } from 'vitest'
import { EmbeddingModalityError } from '@use-crux/core/embedding'
import { createCruxAi } from '../src'
import { scriptedGateway } from './scripted-gateway'

describe('AI SDK embedding modalities', () => {
  it('rejects media before calling the installed text-only embedding contract', async () => {
    const scripted = scriptedGateway()
    const model = createCruxAi({ gateway: scripted.gateway }).embedding({
      name: 'ai-sdk-text',
      model: 'embedding-model' as never,
      dimensions: 2,
      maxInputTokens: 128,
    })

    await expect(model.embed({
      type: 'image',
      source: { type: 'data', data: new Uint8Array([1]), mediaType: 'image/png' },
    } as never)).rejects.toBeInstanceOf(EmbeddingModalityError)
    expect(scripted.calls.embedMany).toEqual([])
  })
})
