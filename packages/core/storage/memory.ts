/**
 * In-memory Storage Beta adapters.
 *
 * Use these factories for tests, examples, and local development when a
 * process-local implementation is sufficient.
 *
 * @module
 */

import { storage } from './bundle'
import { inMemoryBlobStore } from './memory-blob'
import { inMemoryRecordStore } from './memory-record'
import { inMemoryVectorStore } from './memory-vector'
import type { Storage } from './types'

export { inMemoryBlobStore } from './memory-blob'
export { inMemoryRecordStore } from './memory-record'
export { inMemoryVectorStore } from './memory-vector'

/** Create the default in-memory storage bundle. */
export function inMemoryStorage(): Storage {
  return storage({
    records: inMemoryRecordStore(),
    vectors: inMemoryVectorStore(),
    blobs: inMemoryBlobStore(),
  })
}
