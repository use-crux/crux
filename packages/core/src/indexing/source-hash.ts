/**
 * Source content/metadata hashing for corpus change detection.
 *
 * Normalizes content (line endings + trailing whitespace), selects a stable
 * subset of metadata (excluding volatile keys like timestamps), and derives a
 * combined source hash used to decide whether a source changed between syncs.
 *
 * @module
 */

import { stableHash } from './hash'
import type { CruxDocument, SourceHashOptions } from './types'

/** Metadata keys excluded from hashing by default (volatile/derived). */
export const DEFAULT_EXCLUDED_METADATA_KEYS = [
  'mtime',
  'mtimeMs',
  'lastModified',
  'lastFetchedAt',
  'crawledAt',
  'parsedAt',
  'indexedAt',
  'error',
  'errors',
]

/** Compute the content, metadata, and combined source hashes for a document. */
export function computeSourceHashes(
  document: CruxDocument,
  options?: SourceHashOptions,
): {
  contentHash: string
  metadataHash: string
  sourceHash: string
} {
  const normalizedContent = options?.normalizeContent
    ? options.normalizeContent(document.content)
    : normalizeContentForHash(document.content)
  const stableMetadata = selectMetadataForHash(document.metadata ?? {}, options)
  const input = options?.hashDocument
    ? options.hashDocument(document, { normalizedContent, stableMetadata })
    : { content: normalizedContent, metadata: { ...stableMetadata, ...(document.source ? { source: document.source } : {}) } }
  const contentHash = stableHash(input.content)
  const metadataHash = stableHash(input.metadata ?? {})
  return {
    contentHash,
    metadataHash,
    sourceHash: stableHash({ contentHash, metadataHash }),
  }
}

function normalizeContentForHash(content: string): string {
  return content
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trimEnd()
}

function selectMetadataForHash(
  metadata: Record<string, unknown>,
  options?: SourceHashOptions,
): Record<string, unknown> {
  if (options?.metadata === 'none') {
    return {}
  }
  if (options?.includeMetadata) {
    const included: Record<string, unknown> = {}
    for (const key of options.includeMetadata) {
      if (key in metadata) {
        included[key] = metadata[key]
      }
    }
    return included
  }
  if (options?.metadata === 'all') {
    return { ...metadata }
  }
  const excluded = new Set([...(options?.excludeMetadata ?? []), ...DEFAULT_EXCLUDED_METADATA_KEYS])
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !excluded.has(key)))
}
