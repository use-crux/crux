/** Google `Content` projection for one normalized embedding input. @module */

import type { Content } from '@google/genai'
import type { ContentPart } from '@use-crux/core'
import type { NormalizedEmbeddingInput } from '@use-crux/core/embedding'
import { googleContentParts } from './content-parts'

/** Wrap one input as one Content so Google returns one vector for it. */
export function googleEmbeddingContent(input: NormalizedEmbeddingInput): Content {
  if (input.type === 'text') {
    return { role: 'user', parts: [{ text: input.text }] }
  }
  const part: ContentPart = input.type === 'document'
    ? { type: 'file', source: input.asset }
    : { type: input.type, source: input.asset }
  return { role: 'user', parts: googleContentParts('user', [part]) }
}
