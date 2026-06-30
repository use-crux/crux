/**
 * Type-level contract for the canonical Storage Beta API.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and
 * `@ts-expect-error` markers carry the public API contract.
 */

import { expectTypeOf } from 'vitest'
import { storage, StorageError } from '../storage'
import type {
  BlobStore,
  ExactFilter,
  JsonObject,
  RecordEntry,
  RecordStore,
  Storage,
  StorageErrorCode,
  VectorRecord,
  VectorSearchQuery,
} from '../storage'

interface DocumentRecord extends JsonObject {
  readonly title: string
  readonly count: number
  readonly nested: {
    readonly ok: boolean
  }
}

declare const records: RecordStore<DocumentRecord>

expectTypeOf(records.get('docs:a')).resolves.toEqualTypeOf<DocumentRecord | null>()
expectTypeOf(records.list('docs:')).resolves.toEqualTypeOf<{
  readonly entries: readonly RecordEntry<DocumentRecord>[]
  readonly cursor?: string
}>()

if (records.scan) {
  expectTypeOf(records.scan('docs:')).toEqualTypeOf<AsyncIterable<RecordEntry<DocumentRecord>>>()
}

records.put('docs:a', {
  title: 'Alpha',
  count: 1,
  nested: { ok: true },
})
records.put('docs:b', { title: 'Beta', count: 2, nested: { ok: false } }, { ttlMs: 1_000 })
// @ts-expect-error — `ttlMs` is the only public TTL option.
records.put('docs:c', { title: 'Gamma', count: 3, nested: { ok: true } }, { ttl: 1_000 })

// @ts-expect-error — record values must be JSON, not Date/function/class-instance shapes.
declare const badRecords: RecordStore<{ readonly createdAt: Date }>
void badRecords

const exactFilter: ExactFilter = {
  status: 'ready',
  attempts: 2,
  archived: false,
  parent: null,
}
void exactFilter

// @ts-expect-error — filters only allow exact top-level scalar JSON values.
const badFilter: ExactFilter = { tags: ['ready'] }
void badFilter

const denseQuery: VectorSearchQuery = {
  mode: 'dense',
  dense: [1, 0],
  filter: { status: 'ready' },
}
const sparseQuery: VectorSearchQuery = {
  mode: 'sparse',
  sparse: { indices: [0], values: [1] },
}
const hybridQuery: VectorSearchQuery = {
  mode: 'hybrid',
  dense: [1, 0],
  sparse: { indices: [0], values: [1] },
  fusion: 'rrf',
}
void denseQuery
void sparseQuery
void hybridQuery

// @ts-expect-error — dense queries cannot carry sparse vectors.
const invalidDenseQuery: VectorSearchQuery = { mode: 'dense', dense: [1], sparse: { indices: [0], values: [1] } }
void invalidDenseQuery

// @ts-expect-error — sparse queries cannot carry dense vectors.
const invalidSparseQuery: VectorSearchQuery = { mode: 'sparse', sparse: { indices: [0], values: [1] }, dense: [1] }
void invalidSparseQuery

// @ts-expect-error — hybrid queries require both dense and sparse vectors.
const invalidHybridQuery: VectorSearchQuery = { mode: 'hybrid', dense: [1] }
void invalidHybridQuery

const vectorRecord: VectorRecord = {
  key: 'docs:a',
  dense: [1, 0],
  metadata: { status: 'ready', archived: false },
}
void vectorRecord

// @ts-expect-error — vector metadata uses exact scalar filters, not nested objects.
const badVectorRecord: VectorRecord = { key: 'docs:b', dense: [1, 0], metadata: { nested: { ok: true } } }
void badVectorRecord

declare const blobs: BlobStore
const bundle = storage({ records, blobs })

expectTypeOf(bundle).toEqualTypeOf<Storage>()
expectTypeOf(bundle.records).toEqualTypeOf<RecordStore>()
expectTypeOf(bundle.blobs).toEqualTypeOf<BlobStore | undefined>()
expectTypeOf(Object.isFrozen(bundle)).toEqualTypeOf<boolean>()

// @ts-expect-error — canonical storage bundles require `records`.
storage({})
// @ts-expect-error — canonical storage bundles use `records`, not legacy `data`.
storage({ data: records })

const error = new StorageError('invalid_filter', 'Unsupported filter value', { cause: new Error('provider') })
expectTypeOf(error.code).toEqualTypeOf<StorageErrorCode>()
expectTypeOf(error.cause).toEqualTypeOf<unknown>()
