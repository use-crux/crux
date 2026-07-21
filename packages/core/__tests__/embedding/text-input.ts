import type { NormalizedEmbeddingInput } from '../../src/embedding'

/** Read text from a normalized input in text-only provider fakes. */
export function textOf(input: NormalizedEmbeddingInput): string {
  if (input.type !== 'text') throw new Error('Expected text input.')
  return input.text
}
