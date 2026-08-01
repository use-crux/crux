/**
 * Devtools inspection projection for connected knowledge graphs.
 *
 * The projection is read-only and provider-neutral: indexed knowledge records
 * provide aggregate corpus counts while an injected {@link KnowledgeGraphReader}
 * remains the sole source of neighbor traversal semantics.
 *
 * @module
 */

import type { JsonObject, RecordEntry, RecordStore } from '../storage'
import { indexedNamespacePrefix, indexedSourcePrefix, listIndexedEntries } from '../indexed-knowledge/keys'
import type { KnowledgeGraphReader, KnowledgeNeighbor } from './graph-types'
import type { KnowledgeRef } from './refs'

/** Active indexed record counts for one source or corpus total. */
export interface KnowledgeInspectionCounts {
  /** Number of visible documents. */
  readonly documents: number
  /** Number of visible parent records. */
  readonly parents: number
  /** Number of visible chunk records. */
  readonly chunks: number
}

/** Active indexed record counts for one source. */
export interface KnowledgeInspectionSourceSummary extends KnowledgeInspectionCounts {
  /** Source id the counts were projected from. */
  readonly sourceId: string
}

/** Published connected knowledge generation visible to inspection. */
export interface KnowledgeInspectionGenerationSummary {
  /** Whether a persisted connected knowledge generation is published. */
  readonly published: boolean
  /** Published generation id when the caller can provide it. */
  readonly generationId?: string
}

/** Complete aggregate inspection summary for a namespace. */
export interface KnowledgeInspectionSummary {
  /** Per-source active indexed record counts, sorted by source id. */
  readonly sources: readonly KnowledgeInspectionSourceSummary[]
  /** Corpus-wide active indexed record counts. */
  readonly totals: KnowledgeInspectionCounts
  /** Persisted connected knowledge generation state supplied by the caller. */
  readonly generation: KnowledgeInspectionGenerationSummary
}

/** Options accepted by {@link KnowledgeInspectionProjection.summary}. */
export interface KnowledgeInspectionSummaryOptions {
  /** Restrict the summary to these source ids. Missing sources return zero counts. */
  readonly sourceIds?: readonly string[]
}

/** Provider-neutral publication input for connected knowledge generation state. */
export interface KnowledgeInspectionGenerationInput {
  /** Whether a persisted connected knowledge generation is published. */
  readonly published?: boolean
  /** Published generation id when available. */
  readonly generationId?: string
}

/** Configuration for {@link createKnowledgeInspectionProjection}. */
export interface KnowledgeInspectionProjectionConfig {
  /** Indexed knowledge record store to read from. */
  readonly records: RecordStore
  /** Indexer id used by persisted indexed knowledge keys. */
  readonly indexerId: string
  /** Namespace whose active indexed records are visible to inspection. */
  readonly namespace: string
  /** Graph reader that owns all neighbor traversal semantics. */
  readonly graph: KnowledgeGraphReader
  /** Optional persisted generation publication state or resolver. */
  readonly generation?:
    | KnowledgeInspectionGenerationInput
    | (() => Promise<KnowledgeInspectionGenerationInput | null | undefined>)
}

/** Read-only aggregate and neighbor projection for devtools inspection. */
export interface KnowledgeInspectionProjection {
  /**
   * Summarize active indexed records by source.
   *
   * @example
   * ```ts
   * const projection = createKnowledgeInspectionProjection({ records, indexerId: 'docs', namespace: 'kb', graph })
   * const summary = await projection.summary({ sourceIds: ['guide'] })
   * ```
   */
  summary(options?: KnowledgeInspectionSummaryOptions): Promise<KnowledgeInspectionSummary>
  /** Return graph neighbors by delegating to the injected reader unchanged. */
  neighbors(
    ref: KnowledgeRef,
    options?: Parameters<KnowledgeGraphReader['neighbors']>[1],
  ): Promise<KnowledgeNeighbor[]>
}

/** Create the read-only connected knowledge inspection projection. */
export function createKnowledgeInspectionProjection(
  config: KnowledgeInspectionProjectionConfig,
): KnowledgeInspectionProjection {
  async function summary(options: KnowledgeInspectionSummaryOptions = {}): Promise<KnowledgeInspectionSummary> {
    const sources = await sourceSummaries(config, options.sourceIds)
    return {
      sources,
      totals: sources.reduce(addCounts, emptyCounts()),
      generation: await resolveGeneration(config.generation),
    }
  }

  return Object.freeze({
    summary,
    neighbors: (
      ref: KnowledgeRef,
      options?: Parameters<KnowledgeGraphReader['neighbors']>[1],
    ) => config.graph.neighbors(ref, options),
  })
}

async function sourceSummaries(
  config: KnowledgeInspectionProjectionConfig,
  sourceIds: readonly string[] | undefined,
): Promise<KnowledgeInspectionSourceSummary[]> {
  const counts = new Map<string, KnowledgeInspectionCounts>()
  const entries = await listEntries(config, sourceIds)

  for (const entry of entries) {
    const record = activeIndexedRecord(entry.value, config.namespace)
    if (!record) continue
    counts.set(record.sourceId, increment(counts.get(record.sourceId) ?? emptyCounts(), record.type))
  }

  for (const sourceId of sourceIds ?? []) {
    if (!counts.has(sourceId)) counts.set(sourceId, emptyCounts())
  }

  return [...counts.entries()]
    .map(([sourceId, sourceCounts]) => ({
      sourceId,
      ...sourceCounts,
      documents: sourceCounts.parents + sourceCounts.chunks > 0 ? 1 : 0,
    }))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
}

async function listEntries(
  config: KnowledgeInspectionProjectionConfig,
  sourceIds: readonly string[] | undefined,
): Promise<RecordEntry[]> {
  if (!sourceIds) {
    return listIndexedEntries(config.records, indexedNamespacePrefix(config.indexerId, config.namespace))
  }

  const entries: RecordEntry[] = []
  for (const sourceId of unique(sourceIds)) {
    entries.push(
      ...(await listIndexedEntries(config.records, indexedSourcePrefix(config.indexerId, config.namespace, sourceId))),
    )
  }
  return entries
}

function activeIndexedRecord(
  value: JsonObject,
  namespace: string,
): { readonly sourceId: string; readonly type: 'parent' | 'chunk' } | null {
  if (
    value.active !== true ||
    value.namespace !== namespace ||
    typeof value.sourceId !== 'string'
  ) {
    return null
  }
  if (value._cruxRecordType === 'parent' && typeof value.parentId === 'string') {
    return { sourceId: value.sourceId, type: 'parent' }
  }
  if (value._cruxRecordType === 'chunk' && typeof value.chunkId === 'string') {
    return { sourceId: value.sourceId, type: 'chunk' }
  }
  return null
}

function increment(
  counts: KnowledgeInspectionCounts,
  type: 'parent' | 'chunk',
): KnowledgeInspectionCounts {
  if (type === 'parent') return { ...counts, parents: counts.parents + 1 }
  return { ...counts, chunks: counts.chunks + 1 }
}

function addCounts(
  totals: KnowledgeInspectionCounts,
  source: KnowledgeInspectionCounts,
): KnowledgeInspectionCounts {
  return {
    documents: totals.documents + source.documents,
    parents: totals.parents + source.parents,
    chunks: totals.chunks + source.chunks,
  }
}

function emptyCounts(): KnowledgeInspectionCounts {
  return { documents: 0, parents: 0, chunks: 0 }
}

async function resolveGeneration(
  input: KnowledgeInspectionProjectionConfig['generation'],
): Promise<KnowledgeInspectionGenerationSummary> {
  const generation = typeof input === 'function' ? await input() : input
  if (!generation) return { published: false }

  const published = generation.published ?? generation.generationId !== undefined
  return {
    published,
    ...(published && generation.generationId ? { generationId: generation.generationId } : {}),
  }
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values))
}
