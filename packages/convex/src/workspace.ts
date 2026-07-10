/**
 * Convex workspace storage helpers.
 *
 * Bridges `@use-crux/core/storage` blob payloads to Convex file storage while
 * leaving workspace metadata in a normal `RecordStore`.
 *
 * @module
 */

import { StorageError } from '@use-crux/core/storage'
import type { BlobReadResult, BlobRef, BlobStore } from '@use-crux/core/storage'

interface ConvexStorageLike {
  store(content: Blob): Promise<string>
  get?(storageId: string): Promise<Blob | null>
  delete?(storageId: string): Promise<void>
}

export interface ConvexWorkspaceBlobStoreConfig {
  readonly ctx: {
    readonly storage: ConvexStorageLike
  }
}

/**
 * Create a `BlobStore` backed by Convex file storage.
 *
 * Use this together with a Convex `RecordStore`:
 *
 * ```ts
 * import { storage } from '@use-crux/core/storage'
 * import { workspace } from '@use-crux/core/workspace'
 * import { convexRecordStore, convexWorkspaceBlobStore } from '@use-crux/convex'
 *
 * const ws = workspace({
 *   id: 'thread-workspace',
 *   namespace: threadId,
 *   storage: storage({
 *     records: convexRecordStore({ component: components.crux, ctx }),
 *     blobs: convexWorkspaceBlobStore({ ctx }),
 *   }),
 * })
 * ```
 */
export function convexWorkspaceBlobStore(config: ConvexWorkspaceBlobStoreConfig): BlobStore {
  return {
    _tag: 'BlobStore',
    async put(input): Promise<BlobRef> {
      const blob = await toBlob(input.content, input.mimeType)
      const storageId = await config.ctx.storage.store(blob)
      return {
        uri: `convex://${storageId}`,
        size: blob.size,
      }
    },

    async get(uri): Promise<BlobReadResult> {
      const storageId = parseConvexUri(uri)
      if (!config.ctx.storage.get) {
        throw new StorageError(
          'unsupported_capability',
          'convexWorkspaceBlobStore.get() requires ctx.storage.get, which is not available here.',
        )
      }
      const blob = await config.ctx.storage.get(storageId)
      if (!blob) throw new StorageError('not_found', `Convex workspace blob not found for storage id "${storageId}".`)
      return {
        content: blob,
        mimeType: blob.type || 'application/octet-stream',
        size: blob.size,
      }
    },

    async head(uri): Promise<BlobRef | null> {
      const storageId = parseConvexUri(uri)
      if (!config.ctx.storage.get) return null
      const blob = await config.ctx.storage.get(storageId)
      return blob ? { uri, size: blob.size } : null
    },

    async delete(uri): Promise<void> {
      if (!config.ctx.storage.delete) return
      await config.ctx.storage.delete(parseConvexUri(uri))
    },

    capabilities: () => ({
      multipart: false,
      signedUrls: false,
    }),
  }
}

async function toBlob(
  content: string | Uint8Array | Blob | ReadableStream<Uint8Array>,
  mimeType: string,
): Promise<Blob> {
  if (content instanceof Blob) return content
  if (typeof content === 'string') return new Blob([content], { type: mimeType })
  if (content instanceof Uint8Array) {
    const buffer = new ArrayBuffer(content.byteLength)
    new Uint8Array(buffer).set(content)
    return new Blob([buffer], { type: mimeType })
  }
  return await new Response(content).blob()
}

function parseConvexUri(uri: string): string {
  if (!uri.startsWith('convex://')) {
    throw new StorageError('invalid_key', `Expected a convex:// workspace blob URI, got "${uri}".`)
  }
  const storageId = uri.slice('convex://'.length)
  if (!storageId) throw new StorageError('invalid_key', 'Convex workspace blob URI is missing a storage id.')
  return storageId
}
