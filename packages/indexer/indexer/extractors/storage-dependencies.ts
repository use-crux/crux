import type { DependencyFacts } from '@use-crux/core/project-index'
import type { ConfigReader } from '../extensions'
import type { StaticRelationRef } from '../types'

/** Storage config fields that can be resolved from a primitive config object. */
export interface StorageConfigReferences {
  readonly storage?: string
  readonly records?: string
  readonly vectors?: string
  readonly blobs?: string
}

/**
 * Reads Storage Beta config references from a primitive config object.
 *
 * The reader is intentionally conservative: unsupported expressions are omitted
 * instead of guessed, keeping static output stable across TypeScript and Rust/Oxc
 * syntax frontends.
 */
export function storageConfigReferences(config: ConfigReader | undefined): StorageConfigReferences {
  if (!config) return {}
  return compactStorageReferences({
    storage: config.reference('storage'),
    records: config.reference('records'),
    vectors: config.reference('vectors'),
    blobs: config.reference('blobs'),
  })
}

/** Converts storage config references into Project Index dependency facts. */
export function storageDependencyFacts(refs: StorageConfigReferences): DependencyFacts | undefined {
  if (!hasStorageReferences(refs)) return undefined
  return {
    ...(refs.storage ? { storage: [refs.storage] } : {}),
    ...(refs.records ? { recordStores: [refs.records] } : {}),
    ...(refs.vectors ? { vectorStores: [refs.vectors] } : {}),
    ...(refs.blobs ? { blobStores: [refs.blobs] } : {}),
  }
}

/** Builds relation references from a primitive definition to configured storage capabilities. */
export function storageRelationRefs(owner: string, refs: StorageConfigReferences): StaticRelationRef[] {
  return [
    ...(refs.storage ? [{ type: `${owner}.uses_storage`, toVariable: refs.storage }] : []),
    ...(refs.records ? [{ type: `${owner}.uses_record_store`, toVariable: refs.records }] : []),
    ...(refs.vectors ? [{ type: `${owner}.uses_vector_store`, toVariable: refs.vectors }] : []),
    ...(refs.blobs ? [{ type: `${owner}.uses_blob_store`, toVariable: refs.blobs }] : []),
  ]
}

/** Returns whether at least one Storage Beta config reference was found. */
export function hasStorageReferences(refs: StorageConfigReferences): boolean {
  return Boolean(refs.storage || refs.records || refs.vectors || refs.blobs)
}

function compactStorageReferences(refs: StorageConfigReferences): StorageConfigReferences {
  return {
    ...(refs.storage ? { storage: refs.storage } : {}),
    ...(refs.records ? { records: refs.records } : {}),
    ...(refs.vectors ? { vectors: refs.vectors } : {}),
    ...(refs.blobs ? { blobs: refs.blobs } : {}),
  }
}
