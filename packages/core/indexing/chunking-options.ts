/**
 * Default chunking sizes and option normalization.
 *
 * @module
 */

import type { ChunkingOptions } from './types'

/** Default maximum characters per chunk. */
export const DEFAULT_MAX_CHARS = 1200
/** Default overlap characters between adjacent chunks. */
export const DEFAULT_OVERLAP_CHARS = 150

/** Fill in chunking defaults. */
export function normalizeChunkingOptions(options?: ChunkingOptions): Required<ChunkingOptions> {
  return {
    maxChars: options?.maxChars ?? DEFAULT_MAX_CHARS,
    overlapChars: options?.overlapChars ?? DEFAULT_OVERLAP_CHARS,
  }
}
