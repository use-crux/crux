/**
 * Type-level contract for core primitives that consume Storage Beta.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and `@ts-expect-error`
 * markers carry the public API contract.
 */

import { expectTypeOf } from 'vitest'
import { blackboard } from '../agent'
import { createSemanticCache } from '../cache'
import { createSlidingWindow, type GenerateTextFn } from '../compaction'
import { embeddingCache, type DenseEmbedding } from '../embedding'
import { indexer } from '../indexing'
import { memory, recentMessages } from '../memory'
import { retriever } from '../retrieval'
import { config } from '../runtime'
import { handoff } from '../agent'
import { inMemoryRecordStore, inMemoryVectorStore, storage } from '../storage'
import type { RecordStore, Storage, VectorStore } from '../storage'
import { workspace, type WorkspaceConfig } from '../workspace'
import { z } from 'zod'

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
  vectors,
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
  vectors,
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
  vectors,
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
  persistence: {
    records,
  },
})

config({
  persistence: {
    // @ts-expect-error - runtime persistence rejects unknown storage fields.
    extraRecords: records,
  },
})

memory({
  id: 'profile',
  namespace: 'user:1',
  storage: betaStorage,
  blocks: [recentMessages({ id: 'recent' })],
})

memory({
  id: 'profile',
  namespace: 'user:1',
  records,
  vectors,
  blocks: [recentMessages({ id: 'recent' })],
})

memory({
  id: 'profile',
  namespace: 'user:1',
  // @ts-expect-error - memory() rejects unknown storage fields.
  extraRecords: records,
  blocks: [recentMessages({ id: 'recent' })],
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

const generate: GenerateTextFn = async () => ({ text: 'summary' })
createSlidingWindow({
  id: 'chat',
  windowSize: 3,
  generate,
  model: {},
  records,
})

createSlidingWindow({
  id: 'chat',
  windowSize: 3,
  generate,
  model: {},
  // @ts-expect-error - compaction rejects unknown storage fields.
  extraRecords: records,
})

void inMemoryRecordStore
void inMemoryVectorStore
