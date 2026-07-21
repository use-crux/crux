import type { Asset } from '../src/asset'
import { embedding } from '../src/embedding'
import type { EmbeddingInput, NormalizedEmbeddingInput } from '../src/embedding'
import type { MediaSource } from '../src/types/content'

declare const photo: MediaSource
declare const clip: MediaSource
declare const dogAsset: Asset

const textInput: EmbeddingInput<'text' | 'image'> = 'a dog'
const imageInput: EmbeddingInput<'text' | 'image'> = { type: 'image', source: photo }
const assetInput: EmbeddingInput<'text' | 'image'> = dogAsset

// @ts-expect-error Audio is not declared by this embedding input type.
const audioInput: EmbeddingInput<'text' | 'image'> = { type: 'audio', source: clip }

// @ts-expect-error Typed media is rejected by a statically text-only embedding.
const textOnlyImage: EmbeddingInput<'text'> = { type: 'image', source: photo }

// @ts-expect-error Bare assets are rejected by a statically text-only embedding.
const textOnlyAsset: EmbeddingInput<'text'> = dogAsset

void textInput
void imageInput
void assetInput
void audioInput
void textOnlyImage
void textOnlyAsset

const fake = async (
  inputs: readonly NormalizedEmbeddingInput[],
  _context: { readonly role: 'query' | 'document' },
) => inputs.map(() => [1, 2, 3, 4])

const multimodal = embedding({
  kind: 'dense',
  name: 'multimodal',
  dimensions: 4,
  maxInputTokens: 512,
  modalities: ['text', 'image'],
  batch: { maxSize: 8 },
  embed: fake,
})

void multimodal.embed('a dog')
void multimodal.embed({ type: 'image', source: photo })
void multimodal.embed(dogAsset)

// @ts-expect-error Audio is not declared by the const-inferred modalities.
void multimodal.embed({ type: 'audio', source: clip })

const textOnly = embedding({
  kind: 'dense',
  name: 'text-only',
  dimensions: 4,
  maxInputTokens: 512,
  batch: { maxSize: 8 },
  embed: fake,
})

// @ts-expect-error Typed media is rejected when modalities default to text only.
void textOnly.embed({ type: 'image', source: photo })

// @ts-expect-error Bare assets are rejected when modalities default to text only.
void textOnly.embed(dogAsset)
