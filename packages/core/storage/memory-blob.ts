/**
 * Functional in-memory `BlobStore` implementation.
 *
 * Blob refs are process-local `memory://` URIs. The store clones mutable byte
 * content on write and read so tests can assert lifecycle behavior without
 * caller mutation leaking through the adapter.
 *
 * @module
 */

import { StorageError } from './errors'
import { assertExactFilter, assertValidKey, cloneExactFilter } from './memory-utils'
import type { BlobContent, BlobPutInput, BlobReadResult, BlobRef, BlobStore } from './types'

interface StoredBlob {
  readonly ref: BlobRef
  readonly content: BlobContent
  readonly mimeType: string
  readonly metadata?: Record<string, string | number | boolean | null>
}

/** Create an in-memory blob store for tests and local development. */
export function inMemoryBlobStore(): BlobStore {
  const blobs = new Map<string, StoredBlob>()
  let counter = 0

  return {
    _tag: 'BlobStore',
    async put(input) {
      const normalized = await normalizeBlobPutInput(input, () => {
        counter += 1
        return counter
      })
      blobs.set(normalized.ref.uri, normalized)
      return { ...normalized.ref }
    },
    async get(uri) {
      const blob = blobs.get(uri)
      if (!blob) {
        throw new StorageError('not_found', `Blob not found for URI "${uri}".`)
      }
      return {
        content: cloneBlobContent(blob.content),
        mimeType: blob.mimeType,
        size: blob.ref.size,
      }
    },
    async head(uri) {
      const blob = blobs.get(uri)
      return blob ? { ...blob.ref } : null
    },
    async delete(uri) {
      blobs.delete(uri)
    },
    capabilities: () => ({
      multipart: false,
      signedUrls: false,
    }),
  }
}

async function normalizeBlobPutInput(input: BlobPutInput, nextCounter: () => number): Promise<StoredBlob> {
  if (input.key !== undefined) assertValidKey(input.key)
  if (input.mimeType.length === 0) {
    throw new StorageError('invalid_value', 'Blob mimeType must not be empty.')
  }
  if (input.metadata) assertExactFilter(input.metadata)

  const content = cloneBlobContent(input.content)
  const size = await blobContentSize(content)
  const uri = input.key ? `memory://${encodeURIComponent(input.key)}` : `memory://blob/${nextCounter()}`
  return {
    ref: { uri, size },
    content,
    mimeType: input.mimeType,
    ...(input.metadata ? { metadata: cloneExactFilter(input.metadata) } : {}),
  }
}

function cloneBlobContent(content: BlobContent): BlobContent {
  return content instanceof Uint8Array ? new Uint8Array(content) : content
}

async function blobContentSize(content: BlobContent): Promise<number> {
  if (typeof content === 'string') return new TextEncoder().encode(content).byteLength
  if (content instanceof Uint8Array) return content.byteLength
  if (typeof Blob !== 'undefined' && content instanceof Blob) return content.size
  return 0
}
