/**
 * Connected-knowledge integration for the knowledge base runtime.
 *
 * Owns the graph binding cache and the derive → compile → cleanup passes that
 * run around indexing and removal, so the runtime module stays focused on
 * indexing and retrieval wiring. Every pass is a no-op unless the configured
 * pipeline declares derive stages.
 *
 * @module
 */

import { indexedNamespacePrefix, indexedSourcePrefix, listIndexedEntries } from '../indexed-knowledge/keys'
import { compileKnowledgeGeneration, deleteKnowledgeClaimsForSource } from '../knowledge/compile'
import { runDeriveStages } from '../knowledge/derive/runner'
import { createKnowledgeGraphStore } from '../knowledge/graph-store'
import type { KnowledgeGenerationRetention } from '../knowledge/generation'
import type { CruxChunk, CruxDocument, IndexingPipeline } from '../indexing'
import type { JsonObject, RecordStore } from '../storage'
import type { RetrievalKnowledgeBinding } from './recipe/knowledge-binding'

/** Configuration for {@link createConnectedKnowledgeIntegration}. Internal. */
export interface ConnectedKnowledgeIntegrationConfig {
  readonly records?: RecordStore
  readonly indexerId: string
  readonly namespace: string
  readonly pipeline?: IndexingPipeline
  readonly retention: KnowledgeGenerationRetention
}

/** Runtime hooks for connected-knowledge derivation and graph access. Internal. */
export interface ConnectedKnowledgeIntegration {
  /** Return recipe-step graph access when records are configured. */
  binding(): RetrievalKnowledgeBinding | undefined
  /** Run derive stages over active sources and compile a fresh generation. */
  afterIndex(): Promise<void>
  /** Drop a removed source's claims and recompile the graph. */
  afterRemove(sourceId: string): Promise<void>
}

/** Create the connected-knowledge hooks used by the knowledge base runtime. Internal. */
export function createConnectedKnowledgeIntegration(
  config: ConnectedKnowledgeIntegrationConfig,
): ConnectedKnowledgeIntegration {
  const { records, indexerId, namespace } = config
  let graphStore: ReturnType<typeof createKnowledgeGraphStore> | undefined

  function binding(): RetrievalKnowledgeBinding | undefined {
    if (!records) return undefined
    graphStore ??= createKnowledgeGraphStore({ records, indexerId, namespace })
    return {
      reader: graphStore,
      namespace,
      hydrate: graphStore.hydrate,
    }
  }

  async function compile(): Promise<void> {
    if (!records || !hasDeriveStages(config.pipeline)) return
    await compileKnowledgeGeneration({ records, indexerId, namespace, retention: config.retention })
    graphStore = undefined
  }

  async function afterIndex(): Promise<void> {
    if (!records || !hasDeriveStages(config.pipeline)) return
    for (const sourceId of await activeSourceIds(records, indexerId, namespace)) {
      const source = await activeSource(records, indexerId, namespace, sourceId)
      if (!source) continue
      await runDeriveStages({
        records,
        indexerId,
        namespace,
        stages: config.pipeline.derive,
        document: source.document,
        chunks: source.chunks,
      })
    }
    await compile()
  }

  async function afterRemove(sourceId: string): Promise<void> {
    if (!records || !hasDeriveStages(config.pipeline)) return
    await deleteKnowledgeClaimsForSource({
      records,
      indexerId,
      namespace,
      sourceId,
      stageIds: config.pipeline.derive.map((stage) => stage.id),
    })
    await compile()
  }

  return Object.freeze({ binding, afterIndex, afterRemove })
}

function hasDeriveStages(pipeline: IndexingPipeline | undefined): pipeline is IndexingPipeline & {
  readonly derive: readonly [IndexingPipeline['derive'][number], ...IndexingPipeline['derive'][number][]]
} {
  return Boolean(pipeline?.derive.length)
}

async function activeSourceIds(records: RecordStore, indexerId: string, namespace: string): Promise<readonly string[]> {
  const entries = await listIndexedEntries(records, indexedNamespacePrefix(indexerId, namespace))
  const sourceIds = entries.flatMap((entry) => {
    const value = entry.value
    return value.active === true && typeof value.sourceId === 'string' ? [value.sourceId] : []
  })
  return Array.from(new Set(sourceIds)).sort()
}

async function activeSource(
  records: RecordStore,
  indexerId: string,
  namespace: string,
  sourceId: string,
): Promise<{ readonly document: CruxDocument; readonly chunks: readonly CruxChunk[] } | null> {
  const entries = await listIndexedEntries(records, indexedSourcePrefix(indexerId, namespace, sourceId))
  const chunks = entries
    .flatMap((entry) => indexedChunk(entry.value, namespace))
    .sort((left, right) => left.ordinal - right.ordinal || left.chunkId.localeCompare(right.chunkId))
  if (chunks.length === 0) return null
  const first = chunks[0]
  return {
    document: {
      namespace,
      sourceId,
      ...(first?.source ? { source: first.source } : {}),
      content: chunks.map((chunk) => chunk.content).join('\n\n'),
      ...(documentTitle(chunks) ? { title: documentTitle(chunks) } : {}),
      metadata: first?.metadata ?? {},
    },
    chunks,
  }
}

function indexedChunk(value: JsonObject, namespace: string): readonly CruxChunk[] {
  if (
    value._cruxRecordType !== 'chunk' ||
    value.active !== true ||
    value.namespace !== namespace ||
    typeof value.sourceId !== 'string' ||
    typeof value.chunkId !== 'string' ||
    typeof value.ordinal !== 'number' ||
    typeof value.content !== 'string'
  ) {
    return []
  }
  return [{
    namespace,
    sourceId: value.sourceId,
    chunkId: value.chunkId,
    ordinal: value.ordinal,
    content: value.content,
    metadata: isRecord(value.metadata) ? value.metadata : {},
    ...(isRecord(value.source) ? { source: value.source as CruxChunk['source'] } : {}),
    ...(isRecord(value.parent) ? { parent: value.parent as CruxChunk['parent'] } : {}),
    ...(isRecord(value.provenance) ? { provenance: value.provenance as CruxChunk['provenance'] } : {}),
  }]
}

function documentTitle(chunks: readonly CruxChunk[]): string | undefined {
  for (const chunk of chunks) {
    if (chunk.parent?.title) return chunk.parent.title
    if (typeof chunk.metadata.title === 'string') return chunk.metadata.title
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
