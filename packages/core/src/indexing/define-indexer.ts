/** The {@link indexer} factory and composition root. @module */

import { embeddingIdentity, type EmbeddingModality } from '../embedding'
import { createIndexedKnowledgeStore, releaseIndexedEmbeddingSpaceWriter } from '../indexed-knowledge'
import type { RecordStore } from '../storage'
import { normalizePipelineCache } from './cache'
import { normalizeChunkingOptions } from './chunking-options'
import { createIndexerOperations } from './indexer-operations'
import { createIndexWriter } from './index-writer'
import { runIndexOperation } from './observability'
import { indexingPipeline } from './pipeline'
import { createPipelineRunner } from './pipeline-runner'
import { stableHash } from './hash'
import type { IndexFingerprintOptions, Indexer, IndexerConfig } from './types'

/**
 * Create an {@link Indexer} for a namespace.
 *
 * @param config - Storage, embeddings, pipeline, and namespace configuration.
 * @returns A frozen indexer with chunk, write, delete, and clear operations.
 *
 * @example
 * ```ts
 * const index = indexer({ id: 'docs', namespace: 'docs', storage, dense })
 * await index.indexDocuments(documents)
 * ```
 */
export function indexer<const TModality extends EmbeddingModality = 'text'>(
  authoredConfig: IndexerConfig<TModality>,
): Indexer {
  // TypeScript cannot spell an existential `DenseEmbedding<some modality>`.
  // The pipeline validates modalities before provider execution, so erase the
  // captured parameter once at this composition boundary.
  const config = authoredConfig as unknown as IndexerConfig<EmbeddingModality>
  validateConfig(config)

  const pipeline = config.pipeline ?? indexingPipeline()
  const recordStore = getIndexerRecordStore(config)
  const vectorStore = config.vectors ?? config.storage?.vectors
  const indexed = createIndexedKnowledgeStore({
    indexerId: config.id,
    namespace: config.namespace,
    records: recordStore,
    vectors: vectorStore,
  })
  const cache = normalizePipelineCache(config.cache, recordStore, config.id)
  const preparePipeline = createPipelineRunner({
    namespace: config.namespace,
    pipeline,
    cache,
    hasAssetStore: config.storage?.assets !== undefined,
  })
  const writePrepared = createIndexWriter({
    indexerId: config.id,
    namespace: config.namespace,
    records: recordStore,
    indexed,
    assets: config.storage?.assets,
    dense: config.dense,
    sparse: config.sparse,
    cache,
  })
  const operations = createIndexerOperations({
    indexerId: config.id,
    namespace: config.namespace,
    cache,
    preparePipeline,
    writePrepared,
  })

  function fingerprint(options?: IndexFingerprintOptions): string {
    return stableHash({
      indexerId: config.id,
      namespace: config.namespace,
      indexVersion: options?.indexVersion ?? 'default',
      chunking: normalizeChunkingOptions(options?.chunking),
      dense: config.dense ? embeddingIdentity(config.dense) : null,
      sparse: config.sparse ? embeddingIdentity(config.sparse) : null,
      pipeline: pipeline.fingerprint(),
    })
  }

  async function deleteSource(sourceId: string): Promise<number> {
    return runIndexOperation({
      indexerId: config.id,
      namespace: config.namespace,
      operation: 'deleteSource',
      sourceCount: 1,
      chunkCount: 0,
      sourceId,
      run: () => indexed.deleteSource(sourceId),
    })
  }

  async function clear(): Promise<number> {
    return runIndexOperation({
      indexerId: config.id,
      namespace: config.namespace,
      operation: 'clear',
      sourceCount: 0,
      chunkCount: 0,
      run: async () => {
        const deleted = await indexed.clearNamespace()
        await releaseIndexedEmbeddingSpaceWriter({
          records: recordStore,
          indexerId: config.id,
          namespace: config.namespace,
        })
        return deleted
      },
    })
  }

  return Object.freeze({
    id: config.id,
    namespace: config.namespace,
    ...operations,
    fingerprint,
    deleteSource,
    clear,
  })
}

function validateConfig(config: IndexerConfig<EmbeddingModality>): void {
  if (!config.id.trim()) throw new Error('Indexer id must be non-empty.')
  if (!config.namespace.trim()) throw new Error('Indexer namespace must be non-empty.')
}

function getIndexerRecordStore(config: IndexerConfig<EmbeddingModality>): RecordStore {
  const records = config.records ?? config.storage?.records
  if (!records) throw new Error('indexer() requires records or storage.records.')
  return records
}
