/** Compile-time checks for Google embedding modality inference. */

import { expectTypeOf, it } from 'vitest'
import type { GoogleGenAI } from '@google/genai'
import type { DenseEmbedding } from '@use-crux/core/embedding'
import { embedding } from '../src/embedding'

const client = {} as GoogleGenAI
const common = { name: 'google', dimensions: 768, maxInputTokens: 8192 }

const multimodal = embedding(client, { ...common, model: 'gemini-embedding-2' })
expectTypeOf(multimodal).toEqualTypeOf<
  DenseEmbedding<'text' | 'image' | 'audio' | 'video' | 'document'>
>()

const zeroConfigMultimodal = embedding(client, { model: 'gemini-embedding-2' })
expectTypeOf(zeroConfigMultimodal).toEqualTypeOf<
  DenseEmbedding<'text' | 'image' | 'audio' | 'video' | 'document'>
>()

const textOnly = embedding(client, { ...common, model: 'text-embedding-004' })
expectTypeOf(textOnly).toEqualTypeOf<DenseEmbedding<'text'>>()

const explicit = embedding(client, {
  ...common,
  model: 'custom-model',
  modalities: ['text', 'image'],
})
expectTypeOf(explicit).toEqualTypeOf<DenseEmbedding<'text' | 'image'>>()

if (false) {
  multimodal.embed({ type: 'audio', source: new Uint8Array([1]), mediaType: 'audio/wav' })
  explicit.embed({ type: 'image', source: new Uint8Array([1]), mediaType: 'image/png' })
  // @ts-expect-error text-only Google embeddings reject image inputs at compile time
  textOnly.embed({ type: 'image', source: new Uint8Array([1]), mediaType: 'image/png' })
  // @ts-expect-error explicit modalities remain closed to undeclared audio
  explicit.embed({ type: 'audio', source: new Uint8Array([1]), mediaType: 'audio/wav' })
}

it('preserves Google embedding modality inference', () => {
  expectTypeOf(multimodal.modalities).toMatchTypeOf<readonly string[]>()
})
