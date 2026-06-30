/**
 * Type-level contract for core primitives that consume Storage Beta.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and `@ts-expect-error`
 * markers carry the public API contract.
 */

import { expectTypeOf } from 'vitest'
import { createSemanticCache } from '../cache'
import { embeddingCache, type DenseEmbedding } from '../embedding'
import { indexer } from '../indexing'
import { retriever } from '../retrieval'
import { inMemoryRecordStore, inMemoryStorage, inMemoryVectorStore, storage } from '../storage'
import type { RecordStore, Storage, VectorStore } from '../storage'
import { workspace, type WorkspaceConfig } from '../workspace'

declare const records: RecordStore
declare const vectors: VectorStore
declare const dense: DenseEmbedding

const betaStorage = storage({ records, vectors })
expectTypeOf(betaStorage).toEqualTypeOf<Storage>()

workspace({
  id: 'drafts',
  namespace: 'thread:1',
  storage: betaStorage,
} satisfies WorkspaceConfig)

workspace({
  id: 'drafts',
  namespace: 'thread:1',
  records,
} satisfies WorkspaceConfig)

workspace({
  id: 'drafts',
  namespace: 'thread:1',
  // @ts-expect-error - workspace metadata storage is configured as `records`.
  data: records,
} satisfies WorkspaceConfig)

workspace({
  id: 'drafts',
  namespace: 'thread:1',
  // @ts-expect-error - canonical storage bundles use `records`, not `data`.
  storage: storage({ data: records }),
} satisfies WorkspaceConfig)

indexer({
  id: 'docs',
  namespace: 'docs',
  storage: betaStorage,
  dense,
})

indexer({
  id: 'docs',
  namespace: 'docs',
  records,
  vectors,
  dense,
})

indexer({
  id: 'docs',
  namespace: 'docs',
  // @ts-expect-error - indexer() no longer exposes legacy `data`.
  data: records,
  dense,
})

retriever({
  id: 'docs',
  namespace: 'docs',
  storage: betaStorage,
  dense,
})

retriever({
  id: 'docs',
  namespace: 'docs',
  records,
  vectors,
  dense,
})

retriever({
  id: 'docs',
  namespace: 'docs',
  // @ts-expect-error - retriever() no longer exposes legacy `store`.
  store: inMemoryStorage(),
  dense,
})

embeddingCache({
  records,
  namespace: 'embeddings',
  ttlMs: 60_000,
})

embeddingCache({
  // @ts-expect-error - embeddingCache() uses `records`.
  store: records,
  namespace: 'embeddings',
})

createSemanticCache({
  storage: betaStorage,
  embedding: dense,
  ttl: 60_000,
  scope: 'global',
})

createSemanticCache({
  records,
  vectors,
  embedding: dense,
  ttl: 60_000,
  scope: 'global',
})

createSemanticCache({
  // @ts-expect-error - semantic cache no longer accepts a legacy combined store.
  store: inMemoryStorage(),
  embedding: dense,
  ttl: 60_000,
  scope: 'global',
})

void inMemoryRecordStore
void inMemoryVectorStore
