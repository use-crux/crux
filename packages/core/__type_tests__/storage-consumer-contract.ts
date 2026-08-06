/**
 * Type-level contract for core primitives that consume Storage Beta.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and `@ts-expect-error`
 * markers carry the public API contract.
 */

import { expectTypeOf } from 'vitest'
import { blackboard } from '../src/agent'
import { createSemanticCache } from '../src/cache'
import { embeddingCache, type DenseEmbedding } from '../src/embedding'
import { indexer } from '../src/indexing'
import { memory, memoryBlock } from '../src/memory'
import { retriever } from '../src/retrieval'
import { config } from '../src/runtime'
import { handoff } from '../src/agent'
import { inMemoryRecordStore, inMemorySearchStore, storage } from '../src/storage'
import type { RecordStore, SearchStore, Storage } from '../src/storage'
import { workspace, type WorkspaceConfig } from '../src/workspace'
import { z } from 'zod'

declare const records: RecordStore
declare const search: SearchStore
declare const dense: DenseEmbedding

const betaStorage = storage({ records, search })
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
  // @ts-expect-error - workspace rejects unknown storage fields.
  extraRecords: records,
} satisfies WorkspaceConfig)

workspace({
  id: 'drafts',
  namespace: 'thread:1',
  // @ts-expect-error - canonical storage bundles reject unknown storage fields.
  storage: storage({ records, extraRecords: records }),
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
  search,
  dense,
})

indexer({
  id: 'docs',
  namespace: 'docs',
  // @ts-expect-error - indexer() rejects unknown storage fields.
  extraRecords: records,
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
  search,
  dense,
})

retriever({
  id: 'docs',
  namespace: 'docs',
  // @ts-expect-error - retriever() rejects unknown storage fields.
  extraStorage: betaStorage,
  dense,
})

embeddingCache({
  records,
  namespace: 'embeddings',
  ttlMs: 60_000,
})

embeddingCache({
  // @ts-expect-error - embeddingCache() rejects unknown storage fields.
  extraRecords: records,
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
  search,
  embedding: dense,
  ttl: 60_000,
  scope: 'global',
})

createSemanticCache({
  // @ts-expect-error - semantic cache rejects unknown storage fields.
  extraStorage: betaStorage,
  embedding: dense,
  ttl: 60_000,
  scope: 'global',
})

config({
  storage: {
    records,
  },
})

config({
  storage: {
    // @ts-expect-error - runtime storage rejects unknown storage fields.
    extraRecords: records,
  },
})

memory({
  id: 'profile',
  namespace: 'user:1',
  storage: betaStorage,
  blocks: [memoryBlock({ id: 'profile', kind: 'custom' })],
})

memory({
  id: 'profile',
  namespace: 'user:1',
  records,
  search,
  blocks: [memoryBlock({ id: 'profile', kind: 'custom' })],
})

memory({
  id: 'profile',
  namespace: 'user:1',
  // @ts-expect-error - memory() rejects unknown storage fields.
  extraRecords: records,
  blocks: [memoryBlock({ id: 'profile', kind: 'custom' })],
})

blackboard({
  id: 'team',
  schema: z.object({ status: z.string() }),
  records,
})

blackboard({
  id: 'team',
  schema: z.object({ status: z.string() }),
  // @ts-expect-error - blackboard() rejects unknown storage fields.
  extraRecords: records,
})

handoff({
  id: 'research-to-write',
  inputSchema: z.object({ findings: z.string() }),
  outputSchema: z.object({ brief: z.string() }),
  transform: (input) => ({ brief: input.findings }),
  records,
})

handoff({
  id: 'research-to-write',
  inputSchema: z.object({ findings: z.string() }),
  outputSchema: z.object({ brief: z.string() }),
  transform: (input) => ({ brief: input.findings }),
  // @ts-expect-error - handoff() rejects unknown storage fields.
  extraRecords: records,
})

void inMemoryRecordStore
void inMemorySearchStore
